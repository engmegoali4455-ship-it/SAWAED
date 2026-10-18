-- =====================================================================
-- ربط Supabase: الحسابات، التخزين، البث اللحظي، والجدولة.
-- الأجزاء الخاصة بالمنصة محاطة بفحص وجودها كي يعمل الملف محلياً أيضاً.
-- =====================================================================

-- إنشاء ملف profile لكل حساب جديد. الربط بالمهندس/مدير القسم يتم يدوياً
-- من شاشة الإدارة عبر البريد (engineers.user_id / dept_managers.user_id).
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

-- ربط حساب بمهندس عبر البريد (شاشة الإدارة)
create or replace function public.link_account_by_email(p_email text, p_engineer_id text default null,
                                                        p_dept_manager_id text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  if not app.is_global() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_dept_manager_id is not null and not app.is_admin() then
    raise exception 'only admin can link department managers' using errcode = '42501';
  end if;
  select id into v_user from public.profiles where lower(email) = lower(p_email);
  if v_user is null then raise exception 'no account with email %', p_email using errcode = 'P0002'; end if;
  if p_engineer_id is not null then
    update public.engineers set user_id = v_user where id = p_engineer_id;
  end if;
  if p_dept_manager_id is not null then
    update public.dept_managers set user_id = v_user where id = p_dept_manager_id;
  end if;
  return v_user;
end $$;
revoke all on function public.link_account_by_email(text, text, text) from public;
grant execute on function public.link_account_by_email(text, text, text) to authenticated;

do $platform$
begin
  -- -------------------------------------------------------------------
  -- Storage: المسار يبدأ بمعرّف المشروع {project_id}/... فتُطبَّق نفس قواعد RLS
  -- -------------------------------------------------------------------
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public)
    values ('photos', 'photos', false), ('signatures', 'signatures', false),
           ('reports', 'reports', false), ('branding', 'branding', false)
    on conflict (id) do nothing;

    create policy photos_select on storage.objects for select to authenticated
      using (bucket_id in ('photos','signatures')
             and (storage.foldername(name))[1] in (select app.member_project_ids()));
    create policy photos_insert on storage.objects for insert to authenticated
      with check (bucket_id in ('photos','signatures')
                  and (storage.foldername(name))[1] in (select app.member_project_ids()));
    create policy photos_delete on storage.objects for delete to authenticated
      using (bucket_id in ('photos','signatures')
             and (storage.foldername(name))[1] in (select app.manager_project_ids()));
    -- ملفات PDF يكتبها الخادم فقط؛ يقرأها الأعضاء والمالك بعد الاعتماد
    create policy reports_select on storage.objects for select to authenticated
      using (bucket_id = 'reports'
             and ((storage.foldername(name))[1] in (select app.member_project_ids())
                  or exists (select 1 from public.weekly_reports r
                             where r.pdf_path = name and r.status in ('approved','sent')
                               and r.project_id in (select app.external_project_ids()))));
    create policy branding_select on storage.objects for select to authenticated
      using (bucket_id = 'branding');
    create policy branding_write on storage.objects for all to authenticated
      using (bucket_id = 'branding' and app.is_admin())
      with check (bucket_id = 'branding' and app.is_admin());
  end if;

  -- -------------------------------------------------------------------
  -- Realtime: يحترم RLS، فكل شاشة تستلم فقط ما يحق لمستخدمها رؤيته
  -- -------------------------------------------------------------------
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.projects, public.weekly_updates, public.works, public.inspections,
      public.stage_suggestions, public.meetings, public.meeting_actions, public.violations,
      public.risks, public.permits, public.invoices, public.photos, public.weekly_reports,
      public.assignments, public.engineers, public.notifications, public.sync_tombstones;
  end if;

  -- -------------------------------------------------------------------
  -- الجدولة (UTC): 04:00 = 7:00 الرياض، والخميس 09:00 = 12:00 الرياض
  -- -------------------------------------------------------------------
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('daily-digest',   '0 4 * * *', 'select app.run_daily_digest()');
    perform cron.schedule('weekly-reports', '0 9 * * 4', 'select app.generate_weekly_reports()');
  end if;
end $platform$;
