-- Rode antes de cadastrar os dois segredos no Vault. Este arquivo NÃO agenda envios.
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;
select extname from pg_extension where extname in ('pg_cron','pg_net','supabase_vault') order by extname;
