-- =====================================================================
-- سواعد للإشراف الهندسي — المخطط الأساسي
-- كل الجداول في public (مكشوفة عبر PostgREST وتحميها RLS)،
-- والدوال المساعدة في app (غير مكشوفة).
--
-- قرار: المعرّفات text وليست uuid، لأن الاستيراد يحافظ على معرّفات
-- المنصة الحالية كما هي، ولأن الجهاز الميداني يولّد المعرّف محلياً
-- (uuid كنص) قبل المزامنة. القيمة الافتراضية uuid عشوائي.
-- =====================================================================

create extension if not exists pgcrypto;

create schema if not exists app;
grant usage on schema app to authenticated, service_role;

-- "اليوم" بتوقيت الرياض: كل منطق التأخر والانتهاء يعتمد عليه
create or replace function app.today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Riyadh')::date
$$;

-- بداية الأسبوع (السبت) لأي تاريخ؛ الأسبوع من السبت إلى الجمعة
create or replace function app.week_start(d date) returns date
language sql immutable set search_path = '' as $$
  select d - ((extract(dow from d)::int + 1) % 7)
$$;

-- ---------------------------------------------------------------------
-- الهوية والأدوار العامة
-- ---------------------------------------------------------------------

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  phone       text,
  is_admin    boolean not null default false,   -- مدير النظام
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index profiles_email_key on public.profiles (lower(email));

-- مديرو قسم الإشراف: الجدول نفسه هو مصدر الصلاحية (كما التكليفات للمشاريع)
create table public.dept_managers (
  id          text primary key default gen_random_uuid()::text,
  name        text not null,
  email       text,
  department  text check (department in ('architecture','consulting')),
  user_id     uuid unique references public.profiles(id) on delete set null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid, updated_by uuid,
  version     integer not null default 1
);

-- إعدادات عامة (الشعار، اسم الشركة، الترويسة...)
create table public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

-- ---------------------------------------------------------------------
-- المراجع ومراحل الرقابة المركزية
-- ---------------------------------------------------------------------

create table public.code_references (
  id          text primary key default gen_random_uuid()::text,
  code        text not null unique,             -- مثل: SBC 303
  title       text not null,                    -- عنوان فقط، دون نسخ نص الكود
  authority   text not null check (authority in ('sbc','civil_defense','balady','other')),
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  updated_at  timestamptz not null default now()
);

create table public.stages (
  id           text primary key default gen_random_uuid()::text,
  name         text not null,
  sort_order   integer not null unique,
  weight       numeric(5,2) not null check (weight >= 0 and weight <= 100),
  is_pour_gate boolean not null default false,  -- مرحلة تنتهي بفحص "قبل الصب"
  updated_at   timestamptz not null default now(),
  updated_by   uuid
);

create table public.stage_code_references (
  stage_id     text not null references public.stages(id) on delete cascade,
  reference_id text not null references public.code_references(id) on delete cascade,
  primary key (stage_id, reference_id)
);
create index on public.stage_code_references (reference_id);

-- ---------------------------------------------------------------------
-- المشاريع
-- ---------------------------------------------------------------------

create table public.projects (
  id               text primary key default gen_random_uuid()::text,
  name             text not null,
  owner_name       text,
  project_no       text unique,
  department       text check (department in ('architecture','consulting')),
  license_no       text,
  request_no       text,
  service_no       text,
  status           text not null default 'ongoing'
                   check (status in ('ongoing','ending_soon','in_process','done','stopped')),
  current_stage_id text references public.stages(id) on delete set null,
  stage_detail     text,
  supervision_mode text not null default 'full_staff'
                   check (supervision_mode in ('full_staff','visits')),
  invoice_type     text,
  manual_progress  numeric(5,2) check (manual_progress between 0 and 100), -- يتجاوز حساب الأوزان
  last_update_date date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid, updated_by uuid,
  version          integer not null default 1
);
create index on public.projects (status);
create index on public.projects (current_stage_id);

-- ---------------------------------------------------------------------
-- المهندسون والتكليفات (مصدر صلاحية المشروع)
-- ---------------------------------------------------------------------

create table public.engineers (
  id              text primary key default gen_random_uuid()::text,
  name            text not null,
  discipline      text,                       -- التخصص
  grade           text,                       -- التصنيف المهني
  sce_no          text,                       -- رقم عضوية الهيئة السعودية للمهندسين
  sce_expiry      date,
  mobile          text,
  status          text not null default 'active' check (status in ('active','on_leave','inactive')),
  user_id         uuid unique references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid, updated_by uuid,
  version         integer not null default 1
);

create table public.assignments (
  id              text primary key default gen_random_uuid()::text,
  engineer_id     text not null references public.engineers(id) on delete cascade,
  project_id      text not null references public.projects(id) on delete cascade,
  role            text not null check (role in (
                    'project_manager',      -- مدير مشروع الإشراف → صلاحية مدير مشروع
                    'resident_engineer',    -- مهندس مقيم
                    'site_engineer',        -- مهندس إشراف
                    'visiting_engineer',    -- مهندس زيارات
                    'specialist')),         -- مهندس تخصص (كهرباء/ميكانيكا...)
  allocation_pct  numeric(5,2) not null default 100 check (allocation_pct > 0 and allocation_pct <= 100),
  from_date       date,
  to_date         date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid, updated_by uuid,
  version         integer not null default 1,
  check (to_date is null or from_date is null or to_date >= from_date)
);
create index on public.assignments (project_id);
create index on public.assignments (engineer_id);

-- المالك / المقاول (اختياري لاحقاً): قراءة فقط + الرد
create table public.project_external_members (
  project_id  text not null references public.projects(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  party       text not null check (party in ('owner','contractor')),
  created_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index on public.project_external_members (user_id);

-- ---------------------------------------------------------------------
-- الوحدات الميدانية (كلها تحمل project_id لتطبيق RLS مباشرة)
-- ---------------------------------------------------------------------

create table public.weekly_updates (
  id              text primary key default gen_random_uuid()::text,
  project_id      text not null references public.projects(id) on delete cascade,
  update_date     date not null,
  stage_id        text references public.stages(id) on delete set null,
  status          text check (status in ('ongoing','ending_soon','in_process','done','stopped')),
  progress        numeric(5,2) check (progress between 0 and 100),  -- فارغ = من أوزان المراحل
  done_text       text,          -- المنجز
  next_week_plan  text,
  obstacles       text,
  labor_count     integer check (labor_count >= 0),
  visits_count    integer check (visits_count >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid, updated_by uuid,
  version         integer not null default 1
);
create index on public.weekly_updates (project_id, update_date desc);

create table public.works (
  id              text primary key default gen_random_uuid()::text,
  project_id      text not null references public.projects(id) on delete cascade,
  item            text not null,
  discipline      text,
  location        text,          -- الموقع / الدور
  planned_start   date,
  planned_end     date,
  actual_progress numeric(5,2) not null default 0 check (actual_progress between 0 and 100),
  status          text not null default 'not_started'
                  check (status in ('not_started','in_progress','completed','on_hold')),
  executor        text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid, updated_by uuid,
  version         integer not null default 1,
  check (planned_end is null or planned_start is null or planned_end >= planned_start)
);
create index on public.works (project_id);

create table public.inspections (
  id              text primary key default gen_random_uuid()::text,
  project_id      text not null references public.projects(id) on delete cascade,
  kind            text not null check (kind in (
                    'inspection_request',  -- طلب فحص / استلام مرحلة
                    'ncr',                 -- تقرير عدم مطابقة
                    'site_instruction',    -- تعليمات موقع
                    'contractor_notice')), -- إشعار للمقاول
  ref_no          text,
  stage_id        text references public.stages(id) on delete set null,
  description     text not null,
  reference       text,          -- المرجع (مثل SBC 304)
  addressed_to    text,          -- الجهة المطلوب منها
  status          text not null default 'open'
                  check (status in ('open','accepted','accepted_with_notes','rejected','closed')),
  closed_at       date,
  signature_path  text,          -- مسار صورة التوقيع في Storage
  signed_by       uuid references public.profiles(id),
  signed_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid, updated_by uuid,
  version         integer not null default 1
);
create index on public.inspections (project_id, created_at desc);

-- اقتراح نقل المرحلة بعد قبول فحص "قبل الصب" (ينتظر تأكيد المهندس)
create table public.stage_suggestions (
  id              text primary key default gen_random_uuid()::text,
  project_id      text not null references public.projects(id) on delete cascade,
  inspection_id   text references public.inspections(id) on delete cascade,
  from_stage_id   text references public.stages(id) on delete set null,
  to_stage_id     text not null references public.stages(id) on delete cascade,
  status          text not null default 'pending' check (status in ('pending','confirmed','dismissed')),
  decided_by      uuid references public.profiles(id),
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid, updated_by uuid,
  version         integer not null default 1
);
create index on public.stage_suggestions (project_id) where status = 'pending';

create table public.meetings (
  id              text primary key default gen_random_uuid()::text,
  project_id      text not null references public.projects(id) on delete cascade,
  kind            text,          -- النوع
  meeting_date    date not null,
  meeting_no      text,
  location        text,
  attendees       jsonb not null default '[]'::jsonb,   -- [{name, party, role}]
  agenda          text,
  decisions       text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid, updated_by uuid,
  version         integer not null default 1
);
create index on public.meetings (project_id, meeting_date desc);

create table public.meeting_actions (
  id              text primary key default gen_random_uuid()::text,
  meeting_id      text not null references public.meetings(id) on delete cascade,
  project_id      text not null references public.projects(id) on delete cascade, -- مكرر لـ RLS، يُضبط بالمشغّل
  item            text not null,
  owner           text,
  due_date        date,
  status          text not null default 'open' check (status in ('open','in_progress','done','cancelled')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid, updated_by uuid,
  version         integer not null default 1
);
create index on public.meeting_actions (meeting_id);
create index on public.meeting_actions (project_id, due_date) where status in ('open','in_progress');

create table public.violations (
  id                text primary key default gen_random_uuid()::text,
  project_id        text not null references public.projects(id) on delete cascade,
  category          text not null check (category in (
                      'safety','quality','drawings','code','license_terms','environment','road_occupancy')),
  severity          text not null check (severity in ('minor','moderate','major')),
  violator          text,          -- الطرف المخالف
  description       text not null,
  reference         text,
  corrective_action text,
  deadline          date,          -- مهلة التصحيح
  status            text not null default 'open'
                    check (status in ('open','correcting','corrected','closed','escalated')),
  escalated_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid, updated_by uuid,
  version           integer not null default 1
);
create index on public.violations (project_id, status);

create table public.risks (
  id              text primary key default gen_random_uuid()::text,
  project_id      text not null references public.projects(id) on delete cascade,
  title           text not null,
  category        text,
  reference       text,
  probability     smallint not null check (probability between 1 and 5),
  impact          smallint not null check (impact between 1 and 5),
  score           smallint generated always as (probability * impact) stored,
  level           text generated always as (
                    case when probability * impact >= 15 then 'high'
                         when probability * impact >= 8  then 'medium'
                         else 'low' end) stored,
  owner           text,
  treatment       text,
  due_date        date,
  status          text not null default 'open' check (status in ('open','mitigating','closed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid, updated_by uuid,
  version         integer not null default 1
);
create index on public.risks (project_id);

create table public.permits (
  id              text primary key default gen_random_uuid()::text,
  project_id      text not null references public.projects(id) on delete cascade,
  kind            text not null check (kind in (
                    'building_permit',        -- رخصة بناء
                    'balady_service',         -- طلب خدمة بلدي
                    'civil_defense',          -- موافقة الدفاع المدني
                    'completion_certificate', -- شهادة إتمام البناء
                    'occupancy_certificate',  -- شهادة الإشغال
                    'permit',                 -- تصاريح
                    'supervision_contract')), -- عقد الإشراف
  number          text,
  issue_date      date,
  expiry_date     date,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid, updated_by uuid,
  version         integer not null default 1,
  check (expiry_date is null or issue_date is null or expiry_date >= issue_date)
);
create index on public.permits (expiry_date);

create table public.invoices (
  id              text primary key default gen_random_uuid()::text,
  project_id      text not null references public.projects(id) on delete cascade,
  number          text,
  kind            text,
  period_from     date,
  period_to       date,
  amount_sar      numeric(14,2) check (amount_sar >= 0),
  submitted_at    date,
  status          text not null default 'preparing'
                  check (status in ('preparing','submitted','approved','paid','rejected')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid, updated_by uuid,
  version         integer not null default 1
);
create index on public.invoices (project_id);

-- صور لكل الوحدات (حتى 20 لكل سجل) مع GPS ووقت الالتقاط
create table public.photos (
  id                 text primary key default gen_random_uuid()::text,
  project_id         text not null references public.projects(id) on delete cascade,
  entity_type        text not null check (entity_type in
                       ('weekly_update','inspection','violation','meeting','work')),
  entity_id          text not null,
  storage_path       text not null unique,   -- {project_id}/{entity_type}/{entity_id}/{id}.jpg
  phase              text not null default 'general' check (phase in ('general','before','after')),
  taken_at           timestamptz,
  lat                double precision check (lat between -90 and 90),
  lng                double precision check (lng between -180 and 180),
  caption            text,
  selected_for_report boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid, updated_by uuid,
  version            integer not null default 1
);
create index on public.photos (entity_type, entity_id);
create index on public.photos (project_id, created_at desc);

-- رد المالك/المقاول على مخالفة أو طلب فحص
create table public.external_responses (
  id              text primary key default gen_random_uuid()::text,
  project_id      text not null references public.projects(id) on delete cascade,
  entity_type     text not null check (entity_type in ('violation','inspection')),
  entity_id       text not null,
  body            text not null,
  created_at      timestamptz not null default now(),
  created_by      uuid not null default auth.uid()
);
create index on public.external_responses (entity_type, entity_id);

-- ---------------------------------------------------------------------
-- التقارير الأسبوعية
-- ---------------------------------------------------------------------

create table public.weekly_reports (
  id              text primary key default gen_random_uuid()::text,
  project_id      text not null references public.projects(id) on delete cascade,
  week_start      date not null check (extract(dow from week_start) = 6),  -- سبت
  week_end        date generated always as (week_start + 6) stored,        -- جمعة
  status          text not null default 'draft' check (status in ('draft','approved','sent')),
  snapshot        jsonb not null default '{}'::jsonb,  -- كل بيانات الأسبوع وقت التوليد
  notes           text,
  pdf_path        text,
  approved_by     uuid references public.profiles(id),
  approved_at     timestamptz,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid, updated_by uuid,
  version         integer not null default 1,
  unique (project_id, week_start)
);

-- ---------------------------------------------------------------------
-- الإشعارات والتدقيق والمزامنة
-- ---------------------------------------------------------------------

create table public.notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null,      -- major_violation | violation_overdue | daily_digest | ...
  project_id  text references public.projects(id) on delete cascade,
  entity_type text,
  entity_id   text,
  title       text not null,
  body        text,
  payload     jsonb not null default '{}'::jsonb,
  dedupe_key  text,               -- يمنع تكرار نفس التنبيه
  read_at     timestamptz,
  pushed_at   timestamptz,        -- تملؤه Edge Function بعد الإرسال
  created_at  timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index on public.notifications (user_id, created_at desc);

create table public.push_subscriptions (
  id          text primary key default gen_random_uuid()::text,
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  platform    text not null check (platform in ('web','fcm','apns')),
  endpoint    text not null,      -- endpoint لـ Web Push أو token لـ FCM/APNs
  keys        jsonb,
  created_at  timestamptz not null default now(),
  unique (user_id, endpoint)
);

create table public.audit_log (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  record_id   text not null,
  project_id  text,               -- بلا FK كي يبقى السجل بعد حذف المشروع
  action      text not null check (action in ('insert','update','delete')),
  actor       uuid,               -- فارغ = خادم/استيراد
  at          timestamptz not null default now(),
  old_data    jsonb,
  new_data    jsonb
);
create index on public.audit_log (table_name, record_id);
create index on public.audit_log (project_id, at desc);

-- شواهد الحذف ليعرف الجهاز غير المتصل ما حُذف أثناء غيابه
create table public.sync_tombstones (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  record_id   text not null,
  project_id  text,
  deleted_at  timestamptz not null default now()
);
create index on public.sync_tombstones (project_id, deleted_at);
