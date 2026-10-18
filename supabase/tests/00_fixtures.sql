-- أدوات الاختبار وبيانات أساسية مشتركة. يُحمَّل قبل ملفات *_test.sql.
create schema tests;
grant usage on schema tests to authenticated, anon;

create table tests.users (name text primary key, id uuid not null);
grant select on tests.users to authenticated, anon;

-- الدخول كمستخدم (role authenticated + JWT sub) أو الخروج إلى postgres
create function tests.login(p_name text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from tests.users where name = p_name), 'role', 'authenticated')::text, false);
  perform set_config('role', 'authenticated', false);
end $$;
create function tests.logout() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', false);
  perform set_config('request.jwt.claims', '', false);
end $$;

create function tests.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FAIL: %', p_msg; end if;
  raise notice 'ok - %', p_msg;
end $$;

-- ينفّذ SQL ويتوقع خطأ بكود محدد
create function tests.throws(p_sql text, p_errcode text, p_msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_errcode then raise notice 'ok - %', p_msg; return; end if;
    raise exception 'FAIL: % (expected %, got % %)', p_msg, p_errcode, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL: % (no error raised)', p_msg;
end $$;

-- عدد الصفوف التي يؤثر فيها أمر DML (لإثبات أن RLS أخفت الصفوف)
create function tests.affected(p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute p_sql; get diagnostics n = row_count; return n;
end $$;

create function tests.count(p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from (' || p_sql || ') q' into n; return n;
end $$;

grant execute on all functions in schema tests to authenticated, anon;

-- ---------------------------------------------------------------------
-- المستخدمون
-- ---------------------------------------------------------------------
with u(name) as (values ('admin'),('dept'),('pm_a'),('eng_a'),('eng_b'),('eng_expired'),
                        ('eng_future'),('owner_a'),('nobody'))
insert into tests.users select name, gen_random_uuid() from u;

insert into auth.users (id, email, raw_user_meta_data)
select id, name || '@sawaed.test', json_build_object('full_name', name) from tests.users;

update public.profiles set is_admin = true where id = (select id from tests.users where name = 'admin');

insert into public.dept_managers (id, name, email, user_id)
values ('dm1', 'مدير القسم', 'dept@sawaed.test', (select id from tests.users where name = 'dept'));

-- ---------------------------------------------------------------------
-- 11 مرحلة مجموع أوزانها 100 (المرحلة 3 بوابة "قبل الصب")
-- ---------------------------------------------------------------------
insert into public.stages (id, name, sort_order, weight, is_pour_gate) values
  ('st01','التجهيز والحفر',1,5,false), ('st02','الإحلال والردم',2,5,false),
  ('st03','الأساسات',3,10,true),       ('st04','الرقاب والميدات',4,10,true),
  ('st05','الهيكل الإنشائي',5,20,true),('st06','المباني',6,10,false),
  ('st07','التمديدات',7,10,false),     ('st08','اللياسة والعزل',8,10,false),
  ('st09','التشطيبات',9,10,false),     ('st10','الواجهات والموقع العام',10,5,false),
  ('st11','التسليم',11,5,false);

-- ---------------------------------------------------------------------
-- مشروعان؛ كل مهندس مكلّف بواحد فقط
-- ---------------------------------------------------------------------
insert into public.projects (id, name, project_no, status, current_stage_id, supervision_mode)
values ('A', 'فيلا الياسمين', 'P-001', 'ongoing', 'st03', 'full_staff'),
       ('B', 'عمارة النرجس',  'P-002', 'ongoing', 'st05', 'visits');

insert into public.engineers (id, name, discipline, user_id) values
  ('e_pm',  'م. مدير المشروع', 'مدني',  (select id from tests.users where name = 'pm_a')),
  ('e_a',   'م. مقيم أ',       'مدني',  (select id from tests.users where name = 'eng_a')),
  ('e_b',   'م. زيارات ب',     'معماري',(select id from tests.users where name = 'eng_b')),
  ('e_old', 'م. انتهى تكليفه', 'كهرباء',(select id from tests.users where name = 'eng_expired')),
  ('e_new', 'م. لم يبدأ',      'ميكانيكا',(select id from tests.users where name = 'eng_future'));

insert into public.assignments (id, engineer_id, project_id, role, allocation_pct, from_date, to_date) values
  ('as1', 'e_pm',  'A', 'project_manager',   50, app.today() - 30, null),
  ('as2', 'e_a',   'A', 'resident_engineer', 100, app.today() - 30, app.today()),   -- ينتهي اليوم: ما زال سارياً
  ('as3', 'e_b',   'B', 'visiting_engineer', 60, null, null),
  ('as4', 'e_old', 'A', 'specialist',        30, app.today() - 60, app.today() - 1),
  ('as5', 'e_new', 'A', 'specialist',        30, app.today() + 1, null);

insert into public.project_external_members (project_id, user_id, party)
values ('A', (select id from tests.users where name = 'owner_a'), 'owner');

-- سجل واحد على الأقل في كل وحدة لكل مشروع
insert into public.weekly_updates (id, project_id, update_date, stage_id, done_text) values
  ('wu_a', 'A', app.today() - 3, 'st03', 'صب النظافة'), ('wu_b', 'B', app.today() - 3, 'st05', 'سقف الأول');
insert into public.works (id, project_id, item, planned_end) values
  ('w_a', 'A', 'حديد القواعد', app.today() + 5), ('w_b', 'B', 'شدة السقف', app.today() + 5);
insert into public.inspections (id, project_id, kind, description, stage_id) values
  ('i_a', 'A', 'inspection_request', 'فحص حديد القواعد قبل الصب', 'st03'),
  ('i_b', 'B', 'ncr', 'غطاء خرساني غير كاف', 'st05');
insert into public.meetings (id, project_id, meeting_date) values
  ('m_a', 'A', app.today() - 2), ('m_b', 'B', app.today() - 2);
insert into public.meeting_actions (id, meeting_id, project_id, item, due_date) values
  ('ma_a', 'm_a', 'A', 'تقديم جدول توريد الحديد', app.today() - 1),
  ('ma_b', 'm_b', 'B', 'اعتماد عينة البلك', app.today() + 3);
insert into public.violations (id, project_id, category, severity, description) values
  ('v_a', 'A', 'safety', 'minor', 'عدم ارتداء الخوذ'), ('v_b', 'B', 'quality', 'moderate', 'تعشيش');
insert into public.risks (id, project_id, title, probability, impact) values
  ('r_a', 'A', 'تأخر توريد الحديد', 3, 4), ('r_b', 'B', 'انهيار جوانب الحفر', 2, 5);
insert into public.permits (id, project_id, kind, number, issue_date, expiry_date) values
  ('pe_a', 'A', 'building_permit', 'R-1', app.today() - 300, app.today() + 30),
  ('pe_b', 'B', 'civil_defense',   'C-1', app.today() - 100, app.today() + 200);
insert into public.invoices (id, project_id, number, amount_sar, status) values
  ('inv_a', 'A', '1', 25000, 'submitted'), ('inv_b', 'B', '1', 40000, 'approved');
insert into public.photos (id, project_id, entity_type, entity_id, storage_path) values
  ('ph_a', 'A', 'weekly_update', 'wu_a', 'A/weekly_update/wu_a/ph_a.jpg'),
  ('ph_b', 'B', 'weekly_update', 'wu_b', 'B/weekly_update/wu_b/ph_b.jpg');
insert into public.weekly_reports (id, project_id, week_start, status) values
  ('rep_a_draft', 'A', app.week_start(app.today()), 'draft'),
  ('rep_a_old',   'A', app.week_start(app.today()) - 7, 'approved'),
  ('rep_b',       'B', app.week_start(app.today()), 'draft');
