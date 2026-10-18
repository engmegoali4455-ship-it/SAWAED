-- اختبارات الصلاحيات (RLS). كل كتلة تبدأ بـ login وتنتهي بـ logout.
\set QUIET on
set client_min_messages = notice;

-- =====================================================================
-- 1) مدير المشروع لا يقرأ أي سجل من مشروع غير مكلّف به
-- =====================================================================
select tests.login('pm_a');
do $$
declare t text;
begin
  perform tests.ok(tests.count('select 1 from public.projects') = 1, 'pm_a sees exactly one project');
  perform tests.ok(tests.count($q$select 1 from public.projects where id = 'B'$q$) = 0, 'pm_a cannot read project B');
  perform tests.ok(tests.count($q$select 1 from public.v_projects where id = 'B'$q$) = 0, 'pm_a cannot read project B via view');
  foreach t in array array['weekly_updates','works','inspections','stage_suggestions','meetings',
    'meeting_actions','violations','risks','permits','invoices','photos','weekly_reports',
    'assignments','audit_log','sync_tombstones','external_responses'] loop
    perform tests.ok(tests.count(format($q$select 1 from public.%I where project_id = 'B'$q$, t)) = 0,
                     format('pm_a reads 0 rows of project B in %s', t));
  end loop;
  perform tests.ok(tests.count($q$select 1 from public.engineers where id = 'e_b'$q$) = 0,
                   'pm_a cannot see engineer assigned only to B');
  perform tests.ok(tests.count($q$select 1 from public.works where project_id = 'A'$q$) = 1, 'pm_a reads works of A');
  perform tests.ok(tests.count($q$select 1 from public.audit_log where project_id = 'A'$q$) > 0, 'pm_a reads audit log of A');
end $$;

-- لا يكتب ولا يحذف في B
select tests.throws($q$insert into public.risks (project_id, title, probability, impact) values ('B','x',1,1)$q$,
                    '42501', 'pm_a cannot insert into project B');
select tests.ok(tests.affected($q$update public.works set item = 'x' where project_id = 'B'$q$) = 0, 'pm_a cannot update B');
select tests.ok(tests.affected($q$delete from public.works where project_id = 'B'$q$) = 0, 'pm_a cannot delete in B');
select tests.throws($q$update public.works set project_id = 'B' where id = 'w_a'$q$, '42501', 'pm_a cannot move a record to B');

-- ويحذف في مشروعه ويعدّل بياناته
insert into public.risks (id, project_id, title, probability, impact) values ('r_tmp', 'A', 'مؤقت', 1, 1);
select tests.ok(tests.affected($q$delete from public.risks where id = 'r_tmp'$q$) = 1, 'pm_a can delete in A');
select tests.ok(tests.affected($q$update public.projects set stage_detail = 'صب القواعد', version = version where id = 'A'$q$) = 1,
                'pm_a can update project A');
select tests.ok(tests.affected($q$delete from public.projects where id = 'A'$q$) = 0, 'pm_a cannot delete the project itself');
select tests.throws($q$insert into public.assignments (engineer_id, project_id, role) values ('e_b','A','site_engineer')$q$,
                    '42501', 'pm_a cannot assign engineers');
select tests.logout();

-- =====================================================================
-- 2) المهندس: إضافة وتعديل بلا حذف
-- =====================================================================
select tests.login('eng_a');
select tests.ok(tests.count('select 1 from public.projects') = 1, 'eng_a sees only project A');
insert into public.violations (id, project_id, category, severity, description)
values ('v_eng', 'A', 'quality', 'minor', 'نظافة الموقع');
select tests.ok(tests.affected($q$update public.violations set corrective_action = 'تنظيف', version = 1 where id = 'v_eng'$q$) = 1,
                'eng_a can update in A');
do $$
declare t text;
begin
  foreach t in array array['weekly_updates','works','inspections','meetings','meeting_actions',
    'violations','risks','permits','invoices','photos','weekly_reports'] loop
    perform tests.ok(tests.affected(format($q$delete from public.%I where project_id = 'A'$q$, t)) = 0,
                     format('eng_a cannot delete from %s', t));
  end loop;
end $$;
select tests.ok(tests.affected($q$update public.projects set name = 'x' where id = 'A'$q$) = 0,
                'eng_a cannot edit project row directly');
select tests.ok(tests.affected($q$update public.weekly_reports set status = 'approved', version = 1 where id = 'rep_a_draft'$q$) = 0,
                'eng_a cannot approve weekly report');
select tests.throws($q$update public.violations set status = 'escalated', version = 2 where id = 'v_eng'$q$,
                    '42501', 'eng_a cannot escalate a violation');
select tests.throws($q$update public.profiles set is_admin = true where id = auth.uid()$q$,
                    '42501', 'eng_a cannot make self admin');
select tests.ok(tests.affected($q$update public.profiles set full_name = 'م. أحمد' where id = auth.uid()$q$) = 1,
                'eng_a can edit own name');
select tests.throws($q$insert into public.audit_log (table_name, record_id, action) values ('x','x','insert')$q$,
                    '42501', 'eng_a cannot write audit log');
select tests.ok(tests.count('select 1 from public.audit_log') = 0, 'engineer cannot read audit log');
select tests.ok(tests.affected($q$update public.stages set weight = 50 where id = 'st01'$q$) = 0, 'eng_a cannot change stage weights');
select tests.logout();

select tests.ok((select count(*) from public.violations where id = 'v_eng') = 1, 'engineer deletes really did nothing');

-- =====================================================================
-- 3) مصدر الصلاحية = التكليف الساري
-- =====================================================================
select tests.login('eng_expired');
select tests.ok(tests.count('select 1 from public.projects') = 0, 'expired assignment grants nothing');
select tests.ok(tests.count('select 1 from public.works') = 0, 'expired assignment: no works');
select tests.logout();

select tests.login('eng_future');
select tests.ok(tests.count('select 1 from public.projects') = 0, 'future assignment grants nothing yet');
select tests.logout();

-- إنهاء التكليف يسحب الصلاحية فوراً
select tests.login('dept');
update public.assignments set to_date = app.today() - 1, version = 1 where id = 'as2';
select tests.logout();
select tests.login('eng_a');
select tests.ok(tests.count('select 1 from public.projects') = 0, 'ending assignment revokes access immediately');
select tests.logout();
select tests.login('dept');
update public.assignments set to_date = null, version = 2 where id = 'as2';
select tests.logout();
select tests.login('eng_a');
select tests.ok(tests.count('select 1 from public.projects') = 1, 'restoring assignment restores access');
select tests.logout();

-- مهندس موقوف = بلا صلاحية رغم وجود التكليف
update public.engineers set status = 'inactive', version = version where id = 'e_b';
select tests.login('eng_b');
select tests.ok(tests.count('select 1 from public.projects') = 0, 'inactive engineer has no access');
select tests.logout();
update public.engineers set status = 'active', version = version where id = 'e_b';

-- =====================================================================
-- 4) مدير القسم ومدير النظام
-- =====================================================================
select tests.login('dept');
select tests.ok(tests.count('select 1 from public.projects') = 2, 'dept manager sees all projects');
select tests.ok(tests.affected($q$update public.violations set status = 'escalated', version = version where id = 'v_b'$q$) = 1,
                'dept manager can escalate');
select tests.ok((select escalated_at is not null from public.violations where id = 'v_b'), 'escalated_at stamped');
select tests.ok(tests.affected($q$update public.stages set weight = weight where id = 'st01'$q$) = 0,
                'dept manager cannot change stage weights (admin only)');
select tests.logout();

select tests.login('admin');
select tests.ok(tests.count('select 1 from public.projects') = 2, 'admin sees all projects');
select tests.ok(tests.affected($q$update public.app_settings set value = value where key = 'company'$q$) = 1, 'admin edits settings');
select tests.logout();

-- =====================================================================
-- 5) المالك: مشروعه فقط، والتقارير المعتمدة فقط
-- =====================================================================
select tests.login('owner_a');
select tests.ok(tests.count('select 1 from public.projects') = 1, 'owner sees own project');
select tests.ok(tests.count('select 1 from public.weekly_reports') = 1, 'owner sees only the approved report');
select tests.ok(tests.count($q$select 1 from public.weekly_reports where status = 'draft'$q$) = 0, 'owner cannot see drafts');
select tests.ok(tests.count('select 1 from public.works') = 0, 'owner cannot see works');
select tests.ok(tests.count('select 1 from public.invoices') = 0, 'owner cannot see invoices');
select tests.ok(tests.count('select 1 from public.violations') > 0, 'owner sees violations to reply');
insert into public.external_responses (project_id, entity_type, entity_id, body)
values ('A', 'violation', 'v_a', 'تم توفير الخوذ');
select tests.throws($q$insert into public.violations (project_id, category, severity, description) values ('A','safety','minor','x')$q$,
                    '42501', 'owner cannot create violations');
select tests.logout();

-- =====================================================================
-- 6) غير المكلّف وغير المسجّل
-- =====================================================================
select tests.login('nobody');
select tests.ok(tests.count('select 1 from public.projects') = 0, 'user without assignment sees nothing');
select tests.ok(tests.count('select 1 from public.profiles') = 1, 'external/unlinked user sees only own profile');
select tests.logout();

set role anon;
select tests.throws('select * from public.projects', '42501', 'anon has no table access');
reset role;

-- =====================================================================
-- 7) الإشعارات خاصة بصاحبها
-- =====================================================================
insert into public.notifications (user_id, kind, title)
values ((select id from tests.users where name = 'pm_a'), 'test', 'لمدير المشروع');
select tests.login('eng_a');
select tests.ok(tests.count('select 1 from public.notifications') = 0, 'engineer cannot read others notifications');
select tests.throws($q$insert into public.notifications (user_id, kind, title) values (auth.uid(), 'x', 'x')$q$,
                    '42501', 'clients cannot create notifications');
select tests.logout();
select tests.login('pm_a');
select tests.ok(tests.affected('update public.notifications set read_at = now()') = 1, 'owner marks notification read');
select tests.throws($q$update public.notifications set title = 'x'$q$, '42501', 'only read_at is updatable');
select tests.logout();
