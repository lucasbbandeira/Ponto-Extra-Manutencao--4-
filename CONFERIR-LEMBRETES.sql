-- Somente conferência. Executar pelo administrador no SQL Editor.
select full_name,email,active,approval_status,can_approve,receive_he_reminders from public.profiles where role='supervisor';
select count(*) filter(where reminder_started_at is null) as antigos_fora_dos_lembretes,
 count(*) filter(where reminder_started_at is not null and status='pending' and reminder_started_at<now()-interval '48 hours') as novos_pendentes_mais_48h from public.overtime_entries;
select status,count(*) as quantidade,max(coalesce(completed_at,attempted_at,created_at)) as ultimo_evento from private.he_reminder_batches group by status;
select id,status,created_at,attempted_at,completed_at,provider_id,error_code from private.he_reminder_batches order by created_at desc limit 20;
-- Após ativar o Cron:
-- select jobname,schedule,active from cron.job where jobname='he-reminders-hourly';
-- select status,return_message,start_time,end_time from cron.job_run_details where jobid=(select jobid from cron.job where jobname='he-reminders-hourly') order by start_time desc limit 10;
-- Pausar, se necessário: select cron.unschedule(jobid) from cron.job where jobname='he-reminders-hourly';
