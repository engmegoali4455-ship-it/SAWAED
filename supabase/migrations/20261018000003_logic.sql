-- =====================================================================
-- منطق المنظومة: الحسابات، التدقيق، منع التعارض، والتحديث المتسلسل.
-- كل مشغّل هنا يعمل داخل نفس معاملة الحدث الميداني.
-- =====================================================================

-- ---------------------------------------------------------------------
-- الحسابات (دوال نقية تُختبر وحدها)
-- ---------------------------------------------------------------------

-- نسبة الإنجاز من الأوزان = مجموع أوزان المراحل حتى المرحلة الحالية (شاملة)
create or replace function app.stage_progress(p_stage_id text) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(s.weight), 0)
  from public.stages s
  where p_stage_id is not null
    and s.sort_order <= (select sort_order from public.stages where id = p_stage_id)
$$;

create or replace function app.project_progress(p_manual numeric, p_stage_id text) returns numeric
language sql stable set search_path = '' as $$
  select coalesce(p_manual, app.stage_progress(p_stage_id))
$$;

-- المشروع النشط بلا تحديث لأكثر من 7 أيام = متأخر
create or replace function app.is_update_late(p_status text, p_last date, p_today date default app.today())
returns boolean language sql immutable set search_path = '' as $$
  select p_status in ('ongoing','ending_soon','in_process')
     and (p_last is null or p_today - p_last > 7)
$$;

-- البند الذي تجاوز نهايته المخططة دون أن يكتمل = متأخر
create or replace function app.is_work_late(p_planned_end date, p_progress numeric, p_status text,
                                            p_today date default app.today())
returns boolean language sql immutable set search_path = '' as $$
  select p_planned_end is not null and p_planned_end < p_today
     and coalesce(p_progress, 0) < 100 and p_status <> 'completed'
$$;

create or replace function app.risk_level(p_probability int, p_impact int) returns text
language sql immutable set search_path = '' as $$
  select case when p_probability * p_impact >= 15 then 'high'
              when p_probability * p_impact >= 8  then 'medium'
              else 'low' end
$$;

-- ---------------------------------------------------------------------
-- عروض للواجهة (security_invoker: تخضع لـ RLS المستخدم)
-- ---------------------------------------------------------------------
create view public.v_projects with (security_invoker = true) as
select p.*,
       app.project_progress(p.manual_progress, p.current_stage_id) as progress,
       app.is_update_late(p.status, p.last_update_date)             as is_update_late,
       s.name as current_stage_name, s.sort_order as current_stage_order
from public.projects p
left join public.stages s on s.id = p.current_stage_id;

create view public.v_works with (security_invoker = true) as
select w.*, app.is_work_late(w.planned_end, w.actual_progress, w.status) as is_late
from public.works w;

-- تحميل المهندسين (مجموع نسب التفرغ للتكليفات السارية)
create view public.v_engineer_load with (security_invoker = true) as
select e.id as engineer_id, e.name,
       coalesce(sum(a.allocation_pct) filter (
         where (a.from_date is null or a.from_date <= app.today())
           and (a.to_date is null or a.to_date >= app.today())), 0) as load_pct,
       count(a.id) filter (
         where (a.from_date is null or a.from_date <= app.today())
           and (a.to_date is null or a.to_date >= app.today())) as active_projects
from public.engineers e
left join public.assignments a on a.engineer_id = e.id
group by e.id, e.name;

grant select on public.v_projects, public.v_works, public.v_engineer_load to authenticated;

-- ---------------------------------------------------------------------
-- الأعمدة المشتركة + منع الكتابة فوق تعديل جهاز آخر
--   العميل يرسل دائماً version الذي قرأه. إن تغيّر في الخادم منذ ذلك
--   يُرفض التعديل بالخطأ P0409 فتعرض الواجهة الاختلاف للمستخدم.
-- ---------------------------------------------------------------------
create or replace function app.touch_row() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
    new.updated_by := auth.uid();
    new.version := 1;
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := now();
  else
    if new.version is distinct from old.version then
      raise exception 'version_conflict'
        using errcode = 'P0409',
              detail  = json_build_object('table', tg_table_name, 'id', old.id,
                                          'server_version', old.version,
                                          'client_version', new.version)::text,
              hint    = 'reload the record and show the diff to the user';
    end if;
    new.version    := old.version + 1;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := auth.uid();
    new.updated_at := now();
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'projects','engineers','assignments','dept_managers','weekly_updates','works','inspections',
    'stage_suggestions','meetings','meeting_actions','violations','risks','permits','invoices',
    'photos','weekly_reports'
  ] loop
    execute format('create trigger touch_row before insert or update on public.%I
                    for each row execute function app.touch_row()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- سجل التدقيق + شواهد الحذف
-- ---------------------------------------------------------------------
create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_project text := case when tg_table_name = 'projects' then v_row->>'id' else v_row->>'project_id' end;
begin
  if tg_op = 'UPDATE' and v_old - 'updated_at' - 'version' = v_new - 'updated_at' - 'version' then
    return null;  -- لا تغيير فعلي
  end if;
  insert into public.audit_log (table_name, record_id, project_id, action, actor, old_data, new_data)
  values (tg_table_name, coalesce(v_row->>'id', v_row->>'key', (v_row->>'project_id') || ':' || (v_row->>'user_id')), v_project, lower(tg_op), auth.uid(), v_old, v_new);
  if tg_op = 'DELETE' then
    insert into public.sync_tombstones (table_name, record_id, project_id)
    values (tg_table_name, v_row->>'id', v_project);
  end if;
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'projects','engineers','assignments','dept_managers','weekly_updates','works','inspections',
    'stage_suggestions','meetings','meeting_actions','violations','risks','permits','invoices',
    'photos','weekly_reports','stages','app_settings','code_references','project_external_members'
  ] loop
    execute format('create trigger audit_row after insert or update or delete on public.%I
                    for each row execute function app.audit_row()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- حراسة القيم التي لا يحق لكل دور تغييرها
-- ---------------------------------------------------------------------

-- لا أحد يمنح نفسه صلاحية مدير النظام
create or replace function app.guard_profile() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and not app.is_admin()
     and (new.is_admin is distinct from old.is_admin
          or new.is_active is distinct from old.is_active
          or new.email is distinct from old.email) then
    raise exception 'only admin can change is_admin/is_active/email' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger guard_profile before update on public.profiles
  for each row execute function app.guard_profile();

-- اعتماد التقرير: مدير المشروع أو العام فقط، والتقرير المعتمد لا يُعدّل محتواه
create or replace function app.guard_weekly_report() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status and new.status in ('approved','sent') then
    if new.status = 'approved' then
      new.approved_by := auth.uid();
      new.approved_at := now();
    else
      new.sent_at := now();
    end if;
  end if;
  if old.status <> 'draft' and new.snapshot is distinct from old.snapshot then
    raise exception 'approved report snapshot is immutable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_weekly_report before update on public.weekly_reports
  for each row execute function app.guard_weekly_report();

-- التصعيد للجهة المختصة: مدير القسم أو مدير النظام فقط
create or replace function app.guard_violation() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'escalated' and (tg_op = 'INSERT' or old.status <> 'escalated') then
    if auth.uid() is not null and not app.is_global() then
      raise exception 'only department manager can escalate' using errcode = '42501';
    end if;
    new.escalated_at := now();
  end if;
  return new;
end $$;
create trigger guard_violation before insert or update on public.violations
  for each row execute function app.guard_violation();

-- بند المحضر يأخذ مشروع محضره دائماً
create or replace function app.sync_action_project() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select project_id into strict new.project_id from public.meetings where id = new.meeting_id;
  return new;
end $$;
create trigger sync_action_project before insert or update of meeting_id, project_id
  on public.meeting_actions for each row execute function app.sync_action_project();

-- الصورة تتبع مشروع سجلها، وحد أقصى 20 صورة للسجل
create or replace function app.check_photo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_project text;
begin
  execute format('select project_id from public.%I where id = $1',
                 case new.entity_type
                   when 'weekly_update' then 'weekly_updates' when 'inspection' then 'inspections'
                   when 'violation' then 'violations' when 'meeting' then 'meetings'
                   when 'work' then 'works' end)
    into v_project using new.entity_id;
  if v_project is null then
    raise exception 'photo entity % % not found', new.entity_type, new.entity_id using errcode = '23503';
  end if;
  new.project_id := v_project;
  if tg_op = 'INSERT' and (select count(*) from public.photos
                           where entity_type = new.entity_type and entity_id = new.entity_id) >= 20 then
    raise exception 'max 20 photos per record' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger check_photo before insert or update of entity_type, entity_id, project_id
  on public.photos for each row execute function app.check_photo();

-- مجموع أوزان المراحل = 100 (يُفحص عند نهاية المعاملة ليسمح بالتعديل الجماعي)
create or replace function app.check_stage_weights() returns trigger
language plpgsql set search_path = '' as $$
declare v_total numeric;
begin
  select sum(weight) into v_total from public.stages;
  if v_total is not null and v_total <> 100 then
    raise exception 'stage weights must total 100, got %', v_total using errcode = '23514';
  end if;
  return null;
end $$;
create constraint trigger check_stage_weights after insert or update or delete on public.stages
  deferrable initially deferred for each row execute function app.check_stage_weights();

-- ---------------------------------------------------------------------
-- الإشعارات
-- ---------------------------------------------------------------------

-- من يُبلَّغ عن مشروع: مديرو المشروع الحاليون + مديرو القسم
create or replace function app.project_manager_user_ids(p_project_id text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select e.user_id from public.assignments a
  join public.engineers e on e.id = a.engineer_id
  where a.project_id = p_project_id and a.role = 'project_manager'
    and e.user_id is not null and e.status = 'active'
    and (a.from_date is null or a.from_date <= app.today())
    and (a.to_date is null or a.to_date >= app.today())
  union
  select user_id from public.dept_managers where is_active and user_id is not null
$$;

create or replace function app.notify(p_users uuid[], p_kind text, p_project_id text,
                                      p_entity_type text, p_entity_id text,
                                      p_title text, p_body text, p_dedupe text,
                                      p_payload jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications
    (user_id, kind, project_id, entity_type, entity_id, title, body, dedupe_key, payload)
  select distinct u, p_kind, p_project_id, p_entity_type, p_entity_id, p_title, p_body, p_dedupe, p_payload
  from unnest(p_users) u
  join public.profiles pr on pr.id = u and pr.is_active
  on conflict (user_id, dedupe_key) do nothing
$$;

-- المخالفة الجسيمة: إشعار فوري لمدير المشروع ومدير القسم
create or replace function app.on_violation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_project_name text;
begin
  if new.severity = 'major' and (tg_op = 'INSERT' or old.severity <> 'major') then
    select name into v_project_name from public.projects where id = new.project_id;
    perform app.notify(array(select app.project_manager_user_ids(new.project_id)),
      'major_violation', new.project_id, 'violation', new.id,
      'مخالفة جسيمة — ' || v_project_name, left(new.description, 200),
      'major_violation:' || new.id);
  end if;
  return null;
end $$;
create trigger on_violation after insert or update of severity on public.violations
  for each row execute function app.on_violation();

-- ---------------------------------------------------------------------
-- التحديث المتسلسل
-- ---------------------------------------------------------------------

-- تحديث أسبوعي ← مرحلة المشروع وحالته ونسبته وتاريخ آخر تحديث
-- (فقط إذا كان هو الأحدث، حتى لا يُرجع تحديث متأخر المزامنة المشروع للخلف)
create or replace function app.on_weekly_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_latest text;
begin
  select id into v_latest from public.weekly_updates
  where project_id = new.project_id
  order by update_date desc, created_at desc, id desc limit 1;

  if v_latest = new.id then
    update public.projects p set
      current_stage_id = coalesce(new.stage_id, p.current_stage_id),
      status           = coalesce(new.status, p.status),
      manual_progress  = new.progress,   -- فارغ = يعود للحساب من الأوزان
      last_update_date = new.update_date
    where p.id = new.project_id;
  end if;
  return null;
end $$;
create trigger on_weekly_update after insert or update on public.weekly_updates
  for each row execute function app.on_weekly_update();

-- قبول طلب فحص في مرحلة "قبل الصب" ← اقتراح نقل المشروع للمرحلة التالية
create or replace function app.on_inspection() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_next text; v_current text;
begin
  if new.kind = 'inspection_request'
     and new.status in ('accepted','accepted_with_notes')
     and (tg_op = 'INSERT' or old.status not in ('accepted','accepted_with_notes'))
     and exists (select 1 from public.stages where id = new.stage_id and is_pour_gate) then
    select current_stage_id into v_current from public.projects where id = new.project_id;
    select id into v_next from public.stages
      where sort_order > (select sort_order from public.stages where id = new.stage_id)
      order by sort_order limit 1;
    if v_next is not null and v_current is not distinct from new.stage_id
       and not exists (select 1 from public.stage_suggestions
                       where inspection_id = new.id and status = 'pending') then
      insert into public.stage_suggestions (project_id, inspection_id, from_stage_id, to_stage_id)
      values (new.project_id, new.id, new.stage_id, v_next);
    end if;
  end if;
  return null;
end $$;
create trigger on_inspection after insert or update of status on public.inspections
  for each row execute function app.on_inspection();

-- تأكيد المهندس للاقتراح (RPC)
create or replace function public.decide_stage_suggestion(p_id text, p_confirm boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.stage_suggestions;
begin
  select * into s from public.stage_suggestions where id = p_id for update;
  if s.id is null or s.project_id not in (select app.member_project_ids()) then
    raise exception 'not found' using errcode = '42501';
  end if;
  if s.status <> 'pending' then
    raise exception 'already decided' using errcode = '22023';
  end if;
  update public.stage_suggestions
     set status = case when p_confirm then 'confirmed' else 'dismissed' end,
         decided_by = auth.uid(), decided_at = now()
   where id = p_id;
  if p_confirm then
    update public.projects set current_stage_id = s.to_stage_id, manual_progress = null
     where id = s.project_id;
  end if;
end $$;
revoke all on function public.decide_stage_suggestion(text, boolean) from public;
grant execute on function public.decide_stage_suggestion(text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- الإشعار اليومي المجمّع (7:00 صباحاً بتوقيت الرياض عبر pg_cron)
-- ---------------------------------------------------------------------
create or replace function app.run_daily_digest(p_today date default app.today())
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  with items as (
    -- بنود اجتماعات تجاوزت موعدها
    select ma.project_id, 'meeting_action_overdue' as kind, ma.id as entity_id,
           ma.item || ' (موعده ' || ma.due_date || ')' as text
    from public.meeting_actions ma
    where ma.status in ('open','in_progress') and ma.due_date < p_today
    union all
    -- تراخيص تنتهي بعد 30 أو 7 أيام، أو انتهت
    select pe.project_id, 'permit_expiring', pe.id,
           pe.kind || ' ' || coalesce(pe.number, '') || ' ينتهي ' || pe.expiry_date
    from public.permits pe
    where pe.expiry_date - p_today in (30, 7) or pe.expiry_date - p_today between -1 and 0
    union all
    -- مشاريع بلا تحديث لأكثر من 7 أيام
    select p.id, 'update_late', p.id, 'لا يوجد تحديث أسبوعي منذ ' || coalesce(p.last_update_date::text, 'البداية')
    from public.projects p
    where app.is_update_late(p.status, p.last_update_date, p_today)
    union all
    -- مخالفات تجاوزت مهلة التصحيح
    select v.project_id, 'violation_overdue', v.id, 'مخالفة تجاوزت المهلة: ' || left(v.description, 80)
    from public.violations v
    where v.status in ('open','correcting') and v.deadline < p_today
  ),
  recipients as (
    select i.*, u as user_id
    from items i, lateral (
      -- كل أعضاء المشروع الحاليين + مديرو القسم
      select e.user_id from public.assignments a join public.engineers e on e.id = a.engineer_id
      where a.project_id = i.project_id and e.user_id is not null and e.status = 'active'
        and (a.from_date is null or a.from_date <= p_today) and (a.to_date is null or a.to_date >= p_today)
      union
      select user_id from public.dept_managers where is_active and user_id is not null
    ) r(u)
  ),
  per_user as (
    select user_id, count(*) as n,
           jsonb_agg(jsonb_build_object('project_id', project_id, 'kind', kind,
                                        'entity_id', entity_id, 'text', text)) as payload
    from recipients group by user_id
  ),
  ins as (
    insert into public.notifications (user_id, kind, title, body, payload, dedupe_key)
    select pu.user_id, 'daily_digest', 'ملخص المتابعة اليومي',
           pu.n || ' بنداً يحتاج متابعة', pu.payload, 'digest:' || p_today
    from per_user pu join public.profiles pr on pr.id = pu.user_id and pr.is_active
    on conflict (user_id, dedupe_key) do nothing
    returning 1
  )
  select count(*) into v_count from ins;
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- توليد التقرير الأسبوعي (كل خميس) لأسبوع السبت–الجمعة
-- ---------------------------------------------------------------------
create or replace function app.build_report_snapshot(p_project_id text, p_week_start date)
returns jsonb language sql stable security definer set search_path = '' as $$
  with w as (select p_week_start as s, p_week_start + 6 as e)
  select jsonb_build_object(
    'generated_at', now(),
    'week', jsonb_build_object('start', w.s, 'end', w.e),
    'project', (select to_jsonb(v) from public.v_projects v where v.id = p_project_id),
    'updates', coalesce((select jsonb_agg(to_jsonb(u) order by u.update_date)
                 from public.weekly_updates u
                 where u.project_id = p_project_id and u.update_date between w.s and w.e), '[]'),
    'works', coalesce((select jsonb_agg(to_jsonb(x) order by x.planned_end)
                 from public.v_works x where x.project_id = p_project_id
                 and x.status <> 'completed'), '[]'),
    'inspections', coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at)
                 from public.inspections i where i.project_id = p_project_id
                 and (i.status = 'open'
                      or (i.created_at at time zone 'Asia/Riyadh')::date between w.s and w.e
                      or i.closed_at between w.s and w.e)), '[]'),
    'violations', coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at)
                 from public.violations v where v.project_id = p_project_id
                 and (v.status in ('open','correcting','escalated')
                      or (v.updated_at at time zone 'Asia/Riyadh')::date between w.s and w.e)), '[]'),
    'meetings', coalesce((select jsonb_agg(to_jsonb(m) || jsonb_build_object('actions',
                   (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.meeting_actions a
                    where a.meeting_id = m.id)) order by m.meeting_date)
                 from public.meetings m where m.project_id = p_project_id
                 and m.meeting_date between w.s and w.e), '[]'),
    'risks', coalesce((select jsonb_agg(to_jsonb(r) order by r.score desc)
                 from public.risks r where r.project_id = p_project_id and r.status <> 'closed'), '[]'),
    'team', coalesce((select jsonb_agg(jsonb_build_object('name', e.name, 'role', a.role,
                   'discipline', e.discipline, 'allocation_pct', a.allocation_pct))
                 from public.assignments a join public.engineers e on e.id = a.engineer_id
                 where a.project_id = p_project_id
                 and (a.from_date is null or a.from_date <= w.e)
                 and (a.to_date is null or a.to_date >= w.s)), '[]'),
    'photos', coalesce((select jsonb_agg(jsonb_build_object('id', ph.id, 'path', ph.storage_path,
                   'caption', ph.caption, 'taken_at', ph.taken_at, 'lat', ph.lat, 'lng', ph.lng))
                 from public.photos ph where ph.project_id = p_project_id and ph.selected_for_report
                 and (ph.created_at at time zone 'Asia/Riyadh')::date between w.s and w.e), '[]')
  )
  from w
$$;

-- ينشئ مسودة لكل مشروع نشط، ويحدّث المسودات فقط (المعتمد لا يُمس)
create or replace function app.generate_weekly_reports(p_day date default app.today())
returns integer language plpgsql security definer set search_path = '' as $$
declare v_week date := app.week_start(p_day); v_count integer;
begin
  with up as (
    insert into public.weekly_reports (project_id, week_start, snapshot)
    select p.id, v_week, app.build_report_snapshot(p.id, v_week)
    from public.projects p where p.status in ('ongoing','ending_soon','in_process')
    on conflict (project_id, week_start) do update
      set snapshot = excluded.snapshot, version = public.weekly_reports.version
      where public.weekly_reports.status = 'draft'
    returning 1
  )
  select count(*) into v_count from up;
  return v_count;
end $$;
