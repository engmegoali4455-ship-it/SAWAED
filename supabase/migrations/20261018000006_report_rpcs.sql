-- توليد مسودة التقرير الأسبوعي عند الطلب (لمدير المشروع أو العام)، وإرساله للمالك.

create or replace function public.generate_weekly_report(p_project_id text, p_day date default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v_week date := app.week_start(coalesce(p_day, app.today())); v_id text;
begin
  if p_project_id not in (select app.manager_project_ids()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.weekly_reports (project_id, week_start, snapshot)
  values (p_project_id, v_week, app.build_report_snapshot(p_project_id, v_week))
  on conflict (project_id, week_start) do update
    set snapshot = excluded.snapshot, version = public.weekly_reports.version
    where public.weekly_reports.status = 'draft'
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.weekly_reports where project_id = p_project_id and week_start = v_week;
  end if;
  return v_id;
end $$;
revoke all on function public.generate_weekly_report(text, date) from public;
grant execute on function public.generate_weekly_report(text, date) to authenticated;

-- إرسال تقرير معتمد للمالك/المقاول: يغيّر الحالة ويُشعر أعضاء المشروع الخارجيين
create or replace function public.send_weekly_report(p_report_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.weekly_reports; v_name text;
begin
  select * into r from public.weekly_reports where id = p_report_id;
  if r.id is null or r.project_id not in (select app.manager_project_ids()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if r.status = 'draft' then raise exception 'approve the report first' using errcode = '22023'; end if;
  update public.weekly_reports set status = 'sent', version = version where id = r.id;
  select name into v_name from public.projects where id = r.project_id;
  perform app.notify(array(select user_id from public.project_external_members where project_id = r.project_id),
    'report_sent', r.project_id, 'weekly_report', r.id,
    'تقرير الإشراف الأسبوعي — ' || v_name, 'أسبوع ' || r.week_start || ' إلى ' || r.week_end,
    'report_sent:' || r.id);
end $$;
revoke all on function public.send_weekly_report(text) from public;
grant execute on function public.send_weekly_report(text) to authenticated;

-- حفظ المراحل وأوزانها دفعة واحدة (المجموع يُفحص عند نهاية المعاملة)
create or replace function public.save_stages(p_stages jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  -- ترتيب مؤقت سالب لتجنّب تعارض القيد الفريد أثناء إعادة الترتيب
  update public.stages set sort_order = -sort_order;
  insert into public.stages (id, name, sort_order, weight, is_pour_gate, updated_by)
  select coalesce(x->>'id', gen_random_uuid()::text), x->>'name', (x->>'sort_order')::int, (x->>'weight')::numeric,
         coalesce((x->>'is_pour_gate')::boolean, false), auth.uid()
  from jsonb_array_elements(p_stages) x
  on conflict (id) do update set name = excluded.name, sort_order = excluded.sort_order, weight = excluded.weight,
    is_pour_gate = excluded.is_pour_gate, updated_by = excluded.updated_by, updated_at = now();
  delete from public.stages where sort_order < 0
    and id not in (select current_stage_id from public.projects where current_stage_id is not null);
  if exists (select 1 from public.stages where sort_order < 0) then
    raise exception 'cannot remove a stage that projects are currently in' using errcode = '23503';
  end if;
  set constraints all immediate;
end $$;
revoke all on function public.save_stages(jsonb) from public;
grant execute on function public.save_stages(jsonb) to authenticated;

-- ربط مالك/مقاول بمشروع عبر البريد
create or replace function public.add_external_member(p_project_id text, p_email text, p_party text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  if not app.is_global() then raise exception 'forbidden' using errcode = '42501'; end if;
  select id into v_user from public.profiles where lower(email) = lower(p_email);
  if v_user is null then raise exception 'no account with email %', p_email using errcode = 'P0002'; end if;
  insert into public.project_external_members (project_id, user_id, party) values (p_project_id, v_user, p_party)
  on conflict (project_id, user_id) do update set party = excluded.party;
  return v_user;
end $$;
revoke all on function public.add_external_member(text, text, text) from public;
grant execute on function public.add_external_member(text, text, text) to authenticated;

-- updated_at للجداول المرجعية كي تلتقطها المزامنة التزايدية
create or replace function app.bump_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger bump_updated_at before update on public.stages for each row execute function app.bump_updated_at();
create trigger bump_updated_at before update on public.code_references for each row execute function app.bump_updated_at();
create trigger bump_updated_at before update on public.app_settings for each row execute function app.bump_updated_at();
