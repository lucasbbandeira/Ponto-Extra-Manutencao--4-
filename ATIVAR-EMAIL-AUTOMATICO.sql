-- Execute por último: depois de publicar he-reminders, configurar os segredos e testar mode=check.
-- Vault deve conter he_reminder_secret (o MESMO segredo da Edge Function, 32+ caracteres)
-- e he_project_url (a URL HTTPS do projeto Supabase).
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;
do $$ begin
 if not exists(select 1 from vault.decrypted_secrets where name='he_reminder_secret' and length(decrypted_secret)>=32) then raise exception 'Cadastre he_reminder_secret no Vault primeiro'; end if;
 if not exists(select 1 from vault.decrypted_secrets where name='he_project_url' and decrypted_secret ~ '^https://[a-z0-9]+[.]supabase[.]co/?$') then raise exception 'Cadastre he_project_url no Vault primeiro'; end if;
end $$;
select cron.schedule('he-reminders-hourly','0 * * * *',$cron$
 select net.http_post(
  url := rtrim((select decrypted_secret from vault.decrypted_secrets where name='he_project_url'),'/') || '/functions/v1/he-reminders',
  headers := jsonb_build_object('Content-Type','application/json','x-he-reminder-secret',(select decrypted_secret from vault.decrypted_secrets where name='he_reminder_secret')),
  body := '{"mode":"send"}'::jsonb,
  timeout_milliseconds := 120000
 );
$cron$);
select jobname,schedule,active from cron.job where jobname='he-reminders-hourly';
