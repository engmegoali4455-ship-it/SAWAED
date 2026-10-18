-- كل جدول تشترك فيه الواجهة يجب أن يكون في النشر: قناة واحدة تضم جدولاً غير منشور
-- تُعلَن "مشتركة" لكنها لا تستقبل أي حدث إطلاقاً.
do $platform$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['external_responses','stages','code_references','dept_managers','app_settings','profiles',
                             'stage_code_references','project_external_members'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $platform$;
