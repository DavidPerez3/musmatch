-- Supabase runs this schedule in Postgres; no browser, API key or external server required.
-- PostgreSQL WASM used by unit tests has no scheduler. Application timeout logic is tested separately.
do $migration$
begin
  if exists(select 1 from pg_available_extensions where name='pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('musmatch-review-timeouts', '*/5 * * * *',
      'select public.resolve_pending_results_by_timeout();');
  end if;
end $migration$;
