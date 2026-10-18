-- الملخص الأسبوعي بالبريد: الخميس 11:00 UTC (14:00 الرياض) بعد توليد التقارير (12:00 الرياض)
do $platform$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('weekly-email', '0 11 * * 4',
      $c$select net.http_post(url := replace((select value #>> '{}' from public.app_settings where key = 'push_endpoint'), 'dispatch-push', 'weekly-email'),
                               body := '{}'::jsonb,
                               headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', (select value #>> '{}' from public.app_settings where key = 'push_secret')))
         where exists (select 1 from public.app_settings where key = 'push_endpoint')$c$);
  end if;
end $platform$;
