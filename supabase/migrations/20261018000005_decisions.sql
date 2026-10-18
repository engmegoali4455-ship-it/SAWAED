-- =====================================================================
-- قرارات المرحلة 1 المعتمدة:
--  1) البيانات الأساسية للمشروع (الاسم، المالك، الأرقام، القسم، وضع الإشراف،
--     نوع المستخلص) يعدّلها مدير القسم أو مدير النظام فقط. مدير المشروع يعدّل
--     المرحلة وتفصيلها والحالة والنسبة اليدوية.
--  2) المالك/المقاول يرى كل المخالفات وطلبات الفحص في مشروعه (شفافية) — كما هو.
--  3) مراحل "قبل الصب" تُحدَّد من الإعدادات (stages.is_pour_gate)، ويقترحها
--     سكربت الاستيراد آلياً من أسماء المراحل.
--  4) إرسال Push: مشغّل فوري عبر pg_net + مسح احتياطي كل دقيقة (outbox).
-- =====================================================================

create or replace function app.guard_project_master() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and not app.is_global() and (
       new.name is distinct from old.name or new.owner_name is distinct from old.owner_name
    or new.project_no is distinct from old.project_no or new.department is distinct from old.department
    or new.license_no is distinct from old.license_no or new.request_no is distinct from old.request_no
    or new.service_no is distinct from old.service_no
    or new.supervision_mode is distinct from old.supervision_mode
    or new.invoice_type is distinct from old.invoice_type) then
    raise exception 'project master data is managed by the department manager' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_project_master before update on public.projects
  for each row execute function app.guard_project_master();

-- فهارس المزامنة التزايدية (updated_at > آخر سحب)
do $$
declare t text;
begin
  foreach t in array array['projects','engineers','assignments','weekly_updates','works','inspections',
    'stage_suggestions','meetings','meeting_actions','violations','risks','permits','invoices','photos',
    'weekly_reports'] loop
    execute format('create index if not exists %1$s_updated_at_idx on public.%1$I (updated_at)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- إرسال الإشعارات (outbox): كل إشعار pushed_at فارغ ينتظر Edge Function
-- ---------------------------------------------------------------------
create index if not exists notifications_unpushed_idx on public.notifications (created_at) where pushed_at is null;

-- تستدعيها Edge Function بمفتاح الخدمة: تحجز دفعة وتعلّمها لمنع الإرسال المزدوج
create or replace function public.claim_unpushed_notifications(p_limit int default 100)
returns setof public.notifications
language sql security definer set search_path = '' as $$
  update public.notifications n set pushed_at = now()
  where n.id in (select id from public.notifications where pushed_at is null
                 order by created_at limit p_limit for update skip locked)
  returning n.*
$$;
revoke all on function public.claim_unpushed_notifications(int) from public, authenticated;
grant execute on function public.claim_unpushed_notifications(int) to service_role;

do $platform$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
    -- عنوان الدالة يُضبط مرة واحدة: insert into app_settings values ('push_endpoint', '"https://<ref>.functions.supabase.co/dispatch-push"')
    create or replace function app.kick_push() returns trigger
    language plpgsql security definer set search_path = '' as $f$
    declare v_url text := (select value #>> '{}' from public.app_settings where key = 'push_endpoint');
            v_key text := (select value #>> '{}' from public.app_settings where key = 'push_secret');
    begin
      if v_url is not null then
        perform net.http_post(url := v_url, body := '{}'::jsonb,
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', coalesce(v_key, '')));
      end if;
      return null;
    end $f$;
    create trigger kick_push after insert on public.notifications
      for each statement execute function app.kick_push();
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('push-sweep', '* * * * *',
      $c$select net.http_post(url := (select value #>> '{}' from public.app_settings where key = 'push_endpoint'),
                               body := '{}'::jsonb,
                               headers := jsonb_build_object('x-push-secret', (select value #>> '{}' from public.app_settings where key = 'push_secret')))
         where exists (select 1 from public.app_settings where key = 'push_endpoint')$c$);
  end if;
end $platform$;

-- أسرار الإرسال لا يقرأها إلا مدير النظام
drop policy if exists read_all on public.app_settings;
create policy read_all on public.app_settings for select to authenticated
  using (key not in ('push_endpoint','push_secret') or (select app.is_admin()));

-- بريد المهندس من ملف التصدير: يقترح الربط في شاشة الإدارة (الربط نفسه يدوي)
alter table public.engineers add column if not exists email text;
