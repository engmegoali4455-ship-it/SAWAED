-- =====================================================================
-- الصلاحيات — تُفرض هنا في قاعدة البيانات، والواجهة تعكسها فقط.
--
--  مدير النظام      profiles.is_admin
--  مدير القسم       صف نشط في dept_managers مربوط بالحساب
--  مدير مشروع       تكليف ساري بدور project_manager
--  مهندس            تكليف ساري بأي دور آخر (إضافة وتعديل بلا حذف)
--  مالك/مقاول       project_external_members (قراءة التقارير المعتمدة + الرد)
--
-- التكليف "ساري" إذا: from_date فارغ أو <= اليوم، و to_date فارغ أو >= اليوم
-- (بتوقيت الرياض)، والمهندس بحالة active. لا يوجد أي حقل صلاحية يدوي آخر.
-- =====================================================================

create or replace function app.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and is_admin and is_active)
$$;

create or replace function app.is_dept_manager() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.dept_managers dm
                 join public.profiles p on p.id = dm.user_id
                 where dm.user_id = auth.uid() and dm.is_active and p.is_active)
$$;

-- مدير النظام أو مدير القسم: يريان ويعدّلان كل المشاريع
create or replace function app.is_global() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_admin() or app.is_dept_manager()
$$;

-- التكليفات السارية للمستخدم الحالي
create or replace function app.my_active_assignments()
returns table (project_id text, role text)
language sql stable security definer set search_path = '' as $$
  select a.project_id, a.role
  from public.assignments a
  join public.engineers e on e.id = a.engineer_id
  join public.profiles p on p.id = e.user_id
  where e.user_id = auth.uid()
    and e.status = 'active' and p.is_active
    and (a.from_date is null or a.from_date <= app.today())
    and (a.to_date   is null or a.to_date   >= app.today())
$$;

-- مشاريع يقرأ المستخدم كل سجلاتها ويضيف ويعدّل فيها
create or replace function app.member_project_ids() returns setof text
language sql stable security definer set search_path = '' as $$
  select id from public.projects where app.is_global()
  union
  select project_id from app.my_active_assignments()
$$;

-- مشاريع يملك فيها المستخدم صلاحية مدير المشروع (حذف + اعتماد التقرير)
create or replace function app.manager_project_ids() returns setof text
language sql stable security definer set search_path = '' as $$
  select id from public.projects where app.is_global()
  union
  select project_id from app.my_active_assignments() where role = 'project_manager'
$$;

create or replace function app.external_project_ids() returns setof text
language sql stable security definer set search_path = '' as $$
  select m.project_id from public.project_external_members m
  join public.profiles p on p.id = m.user_id
  where m.user_id = auth.uid() and p.is_active
$$;

-- دور المستخدم في مشروع: admin | dept_manager | manager | engineer | owner | contractor | null
create or replace function public.my_project_role(p_project_id text) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when app.is_admin()        then 'admin'
    when app.is_dept_manager() then 'dept_manager'
    when exists (select 1 from app.my_active_assignments()
                 where project_id = p_project_id and role = 'project_manager') then 'manager'
    when exists (select 1 from app.my_active_assignments()
                 where project_id = p_project_id) then 'engineer'
    else (select party from public.project_external_members
          where project_id = p_project_id and user_id = auth.uid())
  end
$$;

-- زملاء المستخدم في المشاريع (لعرض الفريق دون كشف كل المهندسين)
create or replace function app.visible_engineer_ids() returns setof text
language sql stable security definer set search_path = '' as $$
  select id from public.engineers where app.is_global() or user_id = auth.uid()
  union
  select a.engineer_id from public.assignments a
  where a.project_id in (select app.member_project_ids())
$$;

create or replace function app.is_internal() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_global()
      or exists (select 1 from public.engineers where user_id = auth.uid() and status = 'active')
$$;

revoke all on all functions in schema app from public;
grant execute on all functions in schema app to authenticated, service_role;
grant execute on function public.my_project_role(text) to authenticated;

-- ---------------------------------------------------------------------
-- الامتيازات: anon لا يصل لشيء، authenticated يصل والفلترة بـ RLS
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage on all sequences in schema public to authenticated, service_role;
-- سجلات تكتبها المشغّلات فقط
revoke insert, update, delete on public.audit_log, public.sync_tombstones from authenticated;
revoke insert, delete on public.notifications from authenticated;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    -- بدون FORCE: مالك الجداول (دوال security definer والمشغّلات) يتجاوز RLS عمداً
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- جداول المشروع: نفس النمط لكل الوحدات
--   قراءة/إضافة/تعديل: أعضاء المشروع (عام + مدير + مهندس)
--   حذف: مدير المشروع أو العام فقط
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'weekly_updates','works','inspections','stage_suggestions','meetings','meeting_actions',
    'violations','risks','permits','invoices','photos'
  ] loop
    execute format($f$
      create policy member_select on public.%1$I for select to authenticated
        using (project_id in (select app.member_project_ids()));
      create policy member_insert on public.%1$I for insert to authenticated
        with check (project_id in (select app.member_project_ids()));
      create policy member_update on public.%1$I for update to authenticated
        using (project_id in (select app.member_project_ids()))
        with check (project_id in (select app.member_project_ids()));
      create policy manager_delete on public.%1$I for delete to authenticated
        using (project_id in (select app.manager_project_ids()));
    $f$, t);
  end loop;
end $$;

-- المالك/المقاول يقرأ المخالفات وطلبات الفحص وصورها لمشروعه
create policy external_select on public.violations for select to authenticated
  using (project_id in (select app.external_project_ids()));
create policy external_select on public.inspections for select to authenticated
  using (project_id in (select app.external_project_ids()));
create policy external_select on public.photos for select to authenticated
  using (project_id in (select app.external_project_ids())
         and entity_type in ('violation','inspection'));

-- ---------------------------------------------------------------------
-- المشاريع
-- ---------------------------------------------------------------------
create policy member_select on public.projects for select to authenticated
  using (id in (select app.member_project_ids()) or id in (select app.external_project_ids()));
create policy global_insert on public.projects for insert to authenticated
  with check ((select app.is_global()));
-- مدير المشروع يعدّل بيانات مشروعه؛ المهندس يغيّر المرحلة عبر التحديث الأسبوعي فقط
create policy manager_update on public.projects for update to authenticated
  using (id in (select app.manager_project_ids()))
  with check (id in (select app.manager_project_ids()));
create policy global_delete on public.projects for delete to authenticated
  using ((select app.is_global()));

-- ---------------------------------------------------------------------
-- التقارير الأسبوعية
-- ---------------------------------------------------------------------
create policy member_select on public.weekly_reports for select to authenticated
  using (project_id in (select app.member_project_ids())
         or (status in ('approved','sent') and project_id in (select app.external_project_ids())));
-- تُولَّد تلقائياً من الخادم؛ مدير المشروع يحرّر الملاحظات ويعتمد
create policy manager_insert on public.weekly_reports for insert to authenticated
  with check (project_id in (select app.manager_project_ids()));
create policy manager_update on public.weekly_reports for update to authenticated
  using (project_id in (select app.manager_project_ids()))
  with check (project_id in (select app.manager_project_ids()));
create policy manager_delete on public.weekly_reports for delete to authenticated
  using (project_id in (select app.manager_project_ids()) and status = 'draft');

-- ---------------------------------------------------------------------
-- ردود المالك/المقاول
-- ---------------------------------------------------------------------
create policy read_responses on public.external_responses for select to authenticated
  using (project_id in (select app.member_project_ids())
         or project_id in (select app.external_project_ids()));
create policy external_insert on public.external_responses for insert to authenticated
  with check (project_id in (select app.external_project_ids()) and created_by = auth.uid());

-- ---------------------------------------------------------------------
-- المهندسون والتكليفات: يديرها مدير القسم ومدير النظام
-- ---------------------------------------------------------------------
create policy visible_select on public.engineers for select to authenticated
  using (id in (select app.visible_engineer_ids()));
create policy global_write on public.engineers for all to authenticated
  using ((select app.is_global())) with check ((select app.is_global()));

create policy member_select on public.assignments for select to authenticated
  using (project_id in (select app.member_project_ids()));
create policy global_write on public.assignments for all to authenticated
  using ((select app.is_global())) with check ((select app.is_global()));

create policy global_select on public.project_external_members for select to authenticated
  using ((select app.is_global()) or user_id = auth.uid());
create policy global_write on public.project_external_members for all to authenticated
  using ((select app.is_global())) with check ((select app.is_global()));

create policy internal_select on public.dept_managers for select to authenticated
  using ((select app.is_internal()));
create policy admin_write on public.dept_managers for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

-- ---------------------------------------------------------------------
-- الحسابات
-- ---------------------------------------------------------------------
create policy self_or_internal_select on public.profiles for select to authenticated
  using (id = auth.uid() or (select app.is_internal()));
create policy self_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());   -- is_admin/is_active محميان بمشغّل
create policy admin_write on public.profiles for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

-- ---------------------------------------------------------------------
-- المراجع والمراحل والإعدادات: يقرأها الجميع، يعدّلها مدير النظام
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['stages','code_references','stage_code_references','app_settings'] loop
    execute format($f$
      create policy read_all on public.%1$I for select to authenticated using (true);
      create policy admin_write on public.%1$I for all to authenticated
        using ((select app.is_admin())) with check ((select app.is_admin()));
    $f$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- الإشعارات والاشتراكات والتدقيق والمزامنة
-- ---------------------------------------------------------------------
create policy own_select on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy own_mark_read on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy own_all on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- التدقيق: العام يرى الكل، مدير المشروع يرى سجل مشروعه
create policy audit_select on public.audit_log for select to authenticated
  using ((select app.is_global()) or project_id in (select app.manager_project_ids()));

create policy member_select on public.sync_tombstones for select to authenticated
  using (project_id in (select app.member_project_ids()));
