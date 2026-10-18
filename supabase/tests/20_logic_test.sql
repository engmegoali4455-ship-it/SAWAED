-- اختبارات المنطق والتحديث المتسلسل
\set QUIET on

-- =====================================================================
-- الأسبوع من السبت إلى الجمعة
-- =====================================================================
select tests.ok(app.week_start('2026-10-17') = '2026-10-17', 'Saturday starts its own week');   -- سبت
select tests.ok(app.week_start('2026-10-23') = '2026-10-17', 'Friday belongs to previous Saturday');
select tests.ok(app.week_start('2026-10-22') = '2026-10-17', 'Thursday belongs to previous Saturday');
select tests.ok(app.week_start('2026-10-18') = '2026-10-17', 'Sunday belongs to previous Saturday');
select tests.ok(app.week_start('2026-10-24') = '2026-10-24', 'next Saturday starts a new week');
select tests.throws($q$insert into public.weekly_reports (project_id, week_start) values ('A', '2026-10-18')$q$,
                    '23514', 'report week must start on Saturday');

-- =====================================================================
-- نسبة الإنجاز من أوزان المراحل
-- =====================================================================
select tests.ok(app.stage_progress('st01') = 5,   'stage 1 → 5%');
select tests.ok(app.stage_progress('st03') = 20,  'stage 3 → 5+5+10 = 20%');
select tests.ok(app.stage_progress('st11') = 100, 'last stage → 100%');
select tests.ok(app.stage_progress(null) = 0,     'no stage → 0%');
select tests.ok(app.project_progress(37, 'st03') = 37, 'manual progress overrides weights');
select tests.ok((select progress from public.v_projects where id = 'B') = 50, 'view: project B at stage 5 → 50%');

-- مجموع الأوزان يجب أن يبقى 100
select tests.throws($q$set constraints all immediate; update public.stages set weight = 6 where id = 'st01'$q$, '23514', 'weights not totalling 100 rejected');
begin;
  update public.stages set weight = 6 where id = 'st01';
  update public.stages set weight = 4 where id = 'st02';
commit;
select tests.ok((select sum(weight) from public.stages) = 100, 'rebalancing weights in one transaction is allowed');
update public.stages set weight = 5 where id in ('st01','st02');

-- =====================================================================
-- درجة المخاطر
-- =====================================================================
select tests.ok(app.risk_level(3, 5) = 'high' and app.risk_level(5, 5) = 'high', '15+ is high');
select tests.ok(app.risk_level(2, 4) = 'medium' and app.risk_level(2, 7) = 'medium', '8–14 is medium');
select tests.ok(app.risk_level(1, 7) = 'low' and app.risk_level(1, 1) = 'low', 'below 8 is low');
select tests.ok((select score = 12 and level = 'medium' from public.risks where id = 'r_a'), 'stored score/level 3×4');
select tests.throws($q$insert into public.risks (project_id, title, probability, impact) values ('A','x',6,1)$q$,
                    '23514', 'probability must be 1–5');

-- =====================================================================
-- حالات "متأخر"
-- =====================================================================
select tests.ok(not app.is_update_late('ongoing', '2026-10-11', '2026-10-18'), 'update 7 days ago is not late');
select tests.ok(app.is_update_late('ongoing', '2026-10-10', '2026-10-18'), 'update 8 days ago is late');
select tests.ok(app.is_update_late('in_process', null, '2026-10-18'), 'active project never updated is late');
select tests.ok(not app.is_update_late('done', '2026-01-01', '2026-10-18'), 'finished project is never late');
select tests.ok(not app.is_update_late('stopped', null, '2026-10-18'), 'stopped project is never late');

select tests.ok(app.is_work_late('2026-10-17', 80, 'in_progress', '2026-10-18'), 'work past planned end and <100% is late');
select tests.ok(not app.is_work_late('2026-10-18', 80, 'in_progress', '2026-10-18'), 'work due today is not late');
select tests.ok(not app.is_work_late('2026-10-01', 100, 'in_progress', '2026-10-18'), 'work at 100% is not late');
select tests.ok(not app.is_work_late('2026-10-01', 90, 'completed', '2026-10-18'), 'completed work is not late');
select tests.ok(not app.is_work_late(null, 0, 'not_started', '2026-10-18'), 'work without planned end is not late');

-- =====================================================================
-- منع الكتابة فوق تعديل جهاز آخر
-- =====================================================================
select tests.login('eng_a');
update public.works set actual_progress = 30, version = 1 where id = 'w_a';      -- الجهاز 1
select tests.throws($q$update public.works set actual_progress = 40, version = 1 where id = 'w_a'$q$,
                    'P0409', 'stale version from device 2 is rejected');
select tests.ok((select actual_progress = 30 and version = 2 from public.works where id = 'w_a'), 'device 1 edit kept');
select tests.ok((select updated_by = auth.uid() from public.works where id = 'w_a'), 'updated_by stamped');
select tests.logout();

-- =====================================================================
-- سجل التدقيق
-- =====================================================================
select tests.ok((select count(*) from public.audit_log a
                 where a.table_name = 'works' and a.record_id = 'w_a' and a.action = 'update'
                   and a.actor = (select id from tests.users where name = 'eng_a')
                   and (a.old_data->>'actual_progress')::numeric = 0
                   and (a.new_data->>'actual_progress')::numeric = 30) = 1, 'audit has who + before/after');
delete from public.risks where id = 'r_b';
select tests.ok(exists (select 1 from public.audit_log where table_name = 'risks' and record_id = 'r_b' and action = 'delete'),
                'delete audited');
select tests.ok(exists (select 1 from public.sync_tombstones where table_name = 'risks' and record_id = 'r_b' and project_id = 'B'),
                'delete leaves a tombstone for offline devices');

-- =====================================================================
-- تحديث أسبوعي ← المشروع
-- =====================================================================
select tests.login('eng_a');
insert into public.weekly_updates (id, project_id, update_date, stage_id, status, done_text, labor_count)
values ('wu_new', 'A', app.today(), 'st04', 'ongoing', 'صب القواعد', 18);
select tests.ok((select current_stage_id = 'st04' and last_update_date = app.today() and progress = 30
                 from public.v_projects where id = 'A'), 'weekly update moves project stage, date and progress');
-- تحديث قديم يُزامَن متأخراً لا يُرجع المشروع للخلف
insert into public.weekly_updates (id, project_id, update_date, stage_id)
values ('wu_offline_old', 'A', app.today() - 5, 'st02');
select tests.ok((select current_stage_id = 'st04' from public.projects where id = 'A'), 'older offline update does not roll back');
-- نسبة يدوية
update public.weekly_updates set progress = 33, version = 1 where id = 'wu_new';
select tests.ok((select progress = 33 from public.v_projects where id = 'A'), 'manual progress from update applies');
update public.weekly_updates set progress = null, version = 2 where id = 'wu_new';
select tests.ok((select progress = 30 from public.v_projects where id = 'A'), 'clearing manual progress returns to weights');
select tests.ok((select not is_update_late from public.v_projects where id = 'A'), 'project no longer late after update');
select tests.logout();

-- =====================================================================
-- مخالفة جسيمة ← إشعار فوري لمدير المشروع ومدير القسم
-- =====================================================================
select tests.login('eng_a');
insert into public.violations (id, project_id, category, severity, description, deadline)
values ('v_major', 'A', 'safety', 'major', 'عمل على ارتفاع بدون حزام أمان', app.today() + 1);
select tests.logout();
select tests.ok((select count(*) from public.notifications where kind = 'major_violation' and entity_id = 'v_major') = 2,
                'major violation notifies exactly 2 users');
select tests.ok(exists (select 1 from public.notifications where kind = 'major_violation' and entity_id = 'v_major'
                        and user_id = (select id from tests.users where name = 'pm_a')), 'project manager notified');
select tests.ok(exists (select 1 from public.notifications where kind = 'major_violation' and entity_id = 'v_major'
                        and user_id = (select id from tests.users where name = 'dept')), 'dept manager notified');
update public.violations set description = description || '.', version = version where id = 'v_major';
select tests.ok((select count(*) from public.notifications where kind = 'major_violation' and entity_id = 'v_major') = 2,
                'editing does not re-notify');

-- =====================================================================
-- قبول فحص "قبل الصب" ← اقتراح المرحلة التالية بعد تأكيد المهندس
-- =====================================================================
select tests.login('eng_a');
insert into public.inspections (id, project_id, kind, stage_id, description)
values ('i_pour', 'A', 'inspection_request', 'st04', 'فحص حديد الميدات قبل الصب');
update public.inspections set status = 'accepted', closed_at = app.today(), version = 1 where id = 'i_pour';
select tests.ok((select count(*) from public.stage_suggestions
                 where inspection_id = 'i_pour' and to_stage_id = 'st05' and status = 'pending') = 1,
                'accepted pre-pour inspection suggests next stage');
select tests.ok((select current_stage_id = 'st04' from public.projects where id = 'A'), 'stage not moved before confirmation');
select public.decide_stage_suggestion((select id from public.stage_suggestions where inspection_id = 'i_pour'), true);
select tests.ok((select current_stage_id = 'st05' from public.projects where id = 'A'), 'confirming moves project to next stage');
select tests.throws($q$select public.decide_stage_suggestion((select id from public.stage_suggestions where inspection_id = 'i_pour'), true)$q$,
                    '22023', 'suggestion cannot be decided twice');
select tests.logout();

select tests.login('eng_b');
select tests.throws($q$select public.decide_stage_suggestion((select id from public.stage_suggestions limit 1), true)$q$,
                    '42501', 'non-member cannot decide suggestion');
select tests.logout();

-- =====================================================================
-- الصور: تتبع مشروع سجلها، وحد 20
-- =====================================================================
select tests.login('eng_a');
insert into public.photos (project_id, entity_type, entity_id, storage_path, lat, lng, taken_at)
select 'A', 'violation', 'v_major', 'A/violation/v_major/' || g || '.jpg', 24.7136, 46.6753, now()
from generate_series(1, 20) g;
select tests.throws($q$insert into public.photos (project_id, entity_type, entity_id, storage_path)
                      values ('A','violation','v_major','A/violation/v_major/21.jpg')$q$, '23514', '21st photo rejected');
select tests.throws($q$insert into public.photos (project_id, entity_type, entity_id, storage_path)
                      values ('A','weekly_update','wu_b','A/x.jpg')$q$, '42501', 'cannot attach photo to another project''s record');
select tests.logout();

-- =====================================================================
-- بند المحضر يرث مشروع المحضر
-- =====================================================================
insert into public.meeting_actions (id, meeting_id, project_id, item) values ('ma_x', 'm_a', 'B', 'x');
select tests.ok((select project_id = 'A' from public.meeting_actions where id = 'ma_x'), 'meeting action project follows meeting');

-- =====================================================================
-- الإشعار اليومي المجمّع
-- =====================================================================
update public.violations set deadline = app.today() - 2, version = version where id = 'v_a';
select app.run_daily_digest();
select tests.ok(exists (select 1 from public.notifications n
                        where n.kind = 'daily_digest' and n.user_id = (select id from tests.users where name = 'pm_a')
                          and n.payload @> '[{"kind":"permit_expiring","entity_id":"pe_a"}]'
                          and n.payload @> '[{"kind":"meeting_action_overdue","entity_id":"ma_a"}]'
                          and n.payload @> '[{"kind":"violation_overdue","entity_id":"v_a"}]'),
                'digest has permit at 30 days, overdue action and overdue violation');
select tests.ok(not exists (select 1 from public.notifications n
                            where n.kind = 'daily_digest' and n.user_id = (select id from tests.users where name = 'eng_b')
                              and n.payload @> '[{"project_id":"A"}]'), 'digest never leaks other projects');
select tests.ok(app.run_daily_digest() = 0, 'digest is idempotent per day');

-- =====================================================================
-- التقرير الأسبوعي
-- =====================================================================
select tests.ok(app.generate_weekly_reports() >= 1, 'weekly reports generated');
select tests.ok((select jsonb_array_length(snapshot->'updates') >= 1
                   and snapshot->'violations' @> '[{"id":"v_major"}]'
                   and snapshot->'inspections' @> '[{"id":"i_pour"}]'
                   and jsonb_array_length(snapshot->'team') >= 2
                 from public.weekly_reports where id = 'rep_a_draft'), 'snapshot gathers update, violation, inspection, team');
select tests.login('pm_a');
update public.weekly_reports set status = 'approved', version = version where id = 'rep_a_draft';
select tests.ok((select approved_by = auth.uid() and approved_at is not null from public.weekly_reports where id = 'rep_a_draft'),
                'pm approves report; approver stamped');
select tests.throws($q$update public.weekly_reports set snapshot = '{}', version = version where id = 'rep_a_draft'$q$,
                    '42501', 'approved snapshot is immutable');
select tests.logout();
select app.generate_weekly_reports();
select tests.ok((select snapshot <> '{}'::jsonb and status = 'approved' from public.weekly_reports where id = 'rep_a_draft'),
                're-generation leaves approved report untouched');

-- =====================================================================
-- أحمال المهندسين
-- =====================================================================
select tests.ok((select load_pct = 50 from public.v_engineer_load where engineer_id = 'e_pm'), 'engineer load counts active assignments only');
select tests.ok((select load_pct = 0 from public.v_engineer_load where engineer_id = 'e_old'), 'expired assignment not in load');
