-- Atualiza o banco existente. Não apaga ou preenche retroativamente as horas antigas.
begin;
alter table public.overtime_entries add column if not exists location text;
alter table public.overtime_entries add column if not exists glpi text;
alter table public.overtime_entries add column if not exists reminder_started_at timestamptz;
alter table public.profiles add column if not exists receive_he_reminders boolean not null default false;
alter table public.overtime_entries drop constraint if exists overtime_location_length;
alter table public.overtime_entries add constraint overtime_location_length check (location is null or length(location)<=200);
alter table public.overtime_entries drop constraint if exists overtime_glpi_length;
alter table public.overtime_entries add constraint overtime_glpi_length check (glpi is null or length(glpi)<=100);

-- Só a inserção após esta instalação habilita lembretes. Atualizações preservam os antigos excluídos.
create or replace function private.he_reminder_start() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then new.reminder_started_at := statement_timestamp();
 elsif old.reminder_started_at is null then new.reminder_started_at := null;
 elsif old.status='rejected' and new.status='pending' then new.reminder_started_at := statement_timestamp();
 else new.reminder_started_at := old.reminder_started_at; end if;
 return new;
end $$;
drop trigger if exists overtime_reminder_start on public.overtime_entries;
create trigger overtime_reminder_start before insert or update on public.overtime_entries for each row execute function private.he_reminder_start();

create or replace function private.submit_entry_v4(p_work_date date,p_normal_entry time,p_point_exit time,p_overtime_start time,p_final_exit time,p_final_exit_next_day boolean,p_note text,p_is_holiday boolean,p_location text default null,p_glpi text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=(select auth.uid()) and active and approval_status='approved' and role='maintainer') then raise exception 'Use um acesso de manutentor autorizado'; end if;
 perform private.validate_overtime_input_v3(p_work_date,p_normal_entry,p_point_exit,p_overtime_start,p_final_exit,p_final_exit_next_day,p_note,p_is_holiday);
 if length(trim(coalesce(p_location,'')))>200 or length(trim(coalesce(p_glpi,'')))>100 then raise exception 'Localizacao ou GLPI excede o tamanho permitido'; end if;
 insert into public.overtime_entries(worker_id,work_date,normal_entry,point_exit,overtime_start,final_exit,final_exit_next_day,note,is_holiday,location,glpi)
 values((select auth.uid()),p_work_date,case when p_is_holiday then null else p_normal_entry end,case when p_is_holiday then null else p_point_exit end,p_overtime_start,p_final_exit,p_final_exit_next_day,trim(p_note),p_is_holiday,nullif(trim(p_location),''),nullif(trim(p_glpi),''));
end $$;
create or replace function private.revise_entry_v4(p_entry_id uuid,p_work_date date,p_normal_entry time,p_point_exit time,p_overtime_start time,p_final_exit time,p_final_exit_next_day boolean,p_note text,p_is_holiday boolean,p_location text default null,p_glpi text default null)
returns void language plpgsql security definer set search_path='' as $$
declare rec public.overtime_entries%rowtype;
begin
 if not exists(select 1 from public.profiles where id=(select auth.uid()) and active and approval_status='approved' and role='maintainer') then raise exception 'Use um acesso de manutentor autorizado'; end if;
 select * into rec from public.overtime_entries where id=p_entry_id for update;
 if not found or rec.worker_id<>(select auth.uid()) or rec.status<>'rejected' then raise exception 'Somente o autor pode corrigir um lancamento devolvido'; end if;
 perform private.validate_overtime_input_v3(p_work_date,p_normal_entry,p_point_exit,p_overtime_start,p_final_exit,p_final_exit_next_day,p_note,p_is_holiday);
 if length(trim(coalesce(p_location,'')))>200 or length(trim(coalesce(p_glpi,'')))>100 then raise exception 'Localizacao ou GLPI excede o tamanho permitido'; end if;
 update public.overtime_entries set work_date=p_work_date,normal_entry=case when p_is_holiday then null else p_normal_entry end,point_exit=case when p_is_holiday then null else p_point_exit end,overtime_start=p_overtime_start,final_exit=p_final_exit,final_exit_next_day=p_final_exit_next_day,note=trim(p_note),is_holiday=p_is_holiday,location=nullif(trim(p_location),''),glpi=nullif(trim(p_glpi),''),status='pending',rejection_reason=null,reviewed_by=null,reviewed_at=null,submitted_at=now() where id=p_entry_id;
end $$;
create or replace function public.submit_entry_v4(p_work_date date,p_normal_entry time,p_point_exit time,p_overtime_start time,p_final_exit time,p_final_exit_next_day boolean,p_note text,p_is_holiday boolean,p_location text default null,p_glpi text default null)
returns void language sql security invoker set search_path='' as $$ select private.submit_entry_v4(p_work_date,p_normal_entry,p_point_exit,p_overtime_start,p_final_exit,p_final_exit_next_day,p_note,p_is_holiday,p_location,p_glpi) $$;
create or replace function public.revise_entry_v4(p_entry_id uuid,p_work_date date,p_normal_entry time,p_point_exit time,p_overtime_start time,p_final_exit time,p_final_exit_next_day boolean,p_note text,p_is_holiday boolean,p_location text default null,p_glpi text default null)
returns void language sql security invoker set search_path='' as $$ select private.revise_entry_v4(p_entry_id,p_work_date,p_normal_entry,p_point_exit,p_overtime_start,p_final_exit,p_final_exit_next_day,p_note,p_is_holiday,p_location,p_glpi) $$;

-- Permite administrar os destinatários no mesmo formulário de permissões já existente.
create or replace function private.he_normalize_recipient() returns trigger language plpgsql set search_path='' as $$
begin
 if new.role<>'supervisor' or not new.can_approve then new.receive_he_reminders:=false; end if;
 return new;
end $$;
drop trigger if exists profiles_he_recipient on public.profiles;
create trigger profiles_he_recipient before insert or update on public.profiles for each row execute function private.he_normalize_recipient();
create or replace function private.admin_set_profile_v2(p_target uuid,p_role text,p_active boolean,p_can_approve boolean,p_can_export boolean,p_full_name text,p_receive_he_reminders boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not (select private.is_admin()) then raise exception 'Somente o administrador pode alterar usuarios'; end if;
 perform private.admin_set_profile(p_target,p_role,p_active,p_can_approve,p_can_export,p_full_name);
 update public.profiles set receive_he_reminders=coalesce(p_receive_he_reminders,false) and role='supervisor' and can_approve where id=p_target;
end $$;
create or replace function public.admin_set_profile_v2(p_target uuid,p_role text,p_active boolean,p_can_approve boolean,p_can_export boolean,p_full_name text,p_receive_he_reminders boolean)
returns void language sql security invoker set search_path='' as $$ select private.admin_set_profile_v2(p_target,p_role,p_active,p_can_approve,p_can_export,p_full_name,p_receive_he_reminders) $$;

-- Instalação inicial: os gestores ativos com aprovação recebem os avisos. Reexecução não muda preferências.
create table if not exists private.he_reminder_settings(id boolean primary key default true check(id), installed_at timestamptz not null default now());
do $$ begin
 if not exists(select 1 from private.he_reminder_settings) then
  update public.profiles set receive_he_reminders=true where role='supervisor' and active and approval_status='approved' and can_approve;
  insert into private.he_reminder_settings(id) values(true);
 end if;
end $$;
create table if not exists private.he_reminder_batches(
 id uuid primary key default gen_random_uuid(), recipient_id uuid not null references public.profiles(id) on delete cascade,
 status text not null default 'prepared' check(status in ('prepared','sending','sent','failed','unknown','cancelled')),
 items jsonb not null, created_at timestamptz not null default now(), claimed_at timestamptz not null default now(),
 attempted_at timestamptz, completed_at timestamptz, provider_id text, error_code text
);
create unique index if not exists he_reminder_one_active on private.he_reminder_batches(recipient_id) where status in ('prepared','sending');
create table if not exists private.he_reminder_receipts(
 recipient_id uuid not null references public.profiles(id) on delete cascade,
 entry_id uuid not null references public.overtime_entries(id) on delete cascade,
 started_at timestamptz not null, last_sent_at timestamptz not null,
 primary key(recipient_id,entry_id,started_at)
);
create index if not exists he_reminder_pending_idx on public.overtime_entries(reminder_started_at) where status='pending' and reminder_started_at is not null;
alter table private.he_reminder_settings enable row level security;
alter table private.he_reminder_batches enable row level security;
alter table private.he_reminder_receipts enable row level security;
revoke all on private.he_reminder_settings,private.he_reminder_batches,private.he_reminder_receipts from public,anon,authenticated;

-- Operações abaixo só são acessíveis pela função de servidor, nunca pelo navegador.
create or replace function private.he_require_service() returns void language plpgsql set search_path='' as $$
begin
 if coalesce((select auth.jwt()->>'role'),'')<>'service_role' then raise exception 'Servico nao autorizado' using errcode='42501'; end if;
end $$;
create or replace function private.he_complete_batch(p_batch_id uuid,p_result text,p_provider_id text default null)
returns void language plpgsql security definer set search_path='' as $$
declare b private.he_reminder_batches%rowtype;
begin
 perform private.he_require_service();
 if p_result not in ('sent','failed','unknown') then raise exception 'Resultado invalido'; end if;
 select * into b from private.he_reminder_batches where id=p_batch_id for update;
 if not found or b.status<>'sending' then return; end if;
 update private.he_reminder_batches set status=p_result,completed_at=now(),provider_id=left(p_provider_id,250),error_code=case when p_result='sent' then null else p_result end where id=b.id;
 -- Uma resposta perdida pode já ter enviado o e-mail: aguarda 24h para não duplicar.
 if p_result in ('sent','unknown') then
  insert into private.he_reminder_receipts(recipient_id,entry_id,started_at,last_sent_at)
  select b.recipient_id,e.id,e.reminder_started_at,coalesce(b.attempted_at,now())
  from jsonb_to_recordset(b.items) as i(id uuid,started_at timestamptz)
  join public.overtime_entries e on e.id=i.id and e.reminder_started_at=i.started_at
  on conflict(recipient_id,entry_id,started_at) do update set last_sent_at=excluded.last_sent_at;
 end if;
end $$;
create or replace function private.he_claim_batches() returns jsonb language plpgsql security definer set search_path='' as $$
declare p record; b record; items jsonb; answer jsonb:='[]'::jsonb;
begin
 perform private.he_require_service();
 -- A transação serializa a montagem. O envio só ocorre depois, fora do bloqueio.
 perform pg_advisory_xact_lock(72548019);
 for b in select id from private.he_reminder_batches where status='sending' and attempted_at<now()-interval '15 minutes' loop
  perform private.he_complete_batch(b.id,'unknown',null);
 end loop;
 for p in select id from public.profiles where role='supervisor' and active and approval_status='approved' and can_approve and receive_he_reminders order by id loop
  select id,status,claimed_at into b from private.he_reminder_batches where recipient_id=p.id and status in ('prepared','sending');
  if found then
   if b.status='prepared' and b.claimed_at<now()-interval '15 minutes' then
    update private.he_reminder_batches set claimed_at=now() where id=b.id;
    answer:=answer||jsonb_build_array(jsonb_build_object('id',b.id));
   end if;
   continue;
  end if;
  select jsonb_agg(jsonb_build_object('id',q.id,'started_at',q.reminder_started_at)) into items from (
   select e.id,e.reminder_started_at from public.overtime_entries e
   where e.status='pending' and e.reminder_started_at<now()-interval '48 hours'
   and not exists(select 1 from private.he_reminder_receipts r where r.recipient_id=p.id and r.entry_id=e.id and r.started_at=e.reminder_started_at and r.last_sent_at>now()-interval '24 hours')
   order by e.reminder_started_at,e.id limit 500
  ) q;
  if items is not null then
   insert into private.he_reminder_batches(recipient_id,items) values(p.id,items) returning id into b;
   answer:=answer||jsonb_build_array(jsonb_build_object('id',b.id));
  end if;
 end loop;
 return answer;
end $$;
create or replace function private.he_prepare_batch(p_batch_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare b private.he_reminder_batches%rowtype; p public.profiles%rowtype; rows jsonb;
begin
 perform private.he_require_service();
 select * into b from private.he_reminder_batches where id=p_batch_id for update;
 if not found or b.status<>'prepared' then return null; end if;
 select * into p from public.profiles where id=b.recipient_id and role='supervisor' and active and approval_status='approved' and can_approve and receive_he_reminders;
 if not found then update private.he_reminder_batches set status='cancelled',completed_at=now() where id=b.id; return null; end if;
 -- Última conferência: horas analisadas enquanto o lote era montado são removidas.
 select jsonb_agg(jsonb_build_object('id',e.id,'worker',w.full_name,'work_date',e.work_date,'minutes',e.minutes,'location',e.location,'glpi',e.glpi,'started_at',e.reminder_started_at) order by e.reminder_started_at,e.id) into rows
 from jsonb_to_recordset(b.items) as i(id uuid,started_at timestamptz)
 join public.overtime_entries e on e.id=i.id and e.reminder_started_at=i.started_at
 join public.profiles w on w.id=e.worker_id
 where e.status='pending' and e.reminder_started_at<now()-interval '48 hours';
 if rows is null then update private.he_reminder_batches set status='cancelled',completed_at=now() where id=b.id; return null; end if;
 update private.he_reminder_batches set status='sending',attempted_at=now() where id=b.id;
 return jsonb_build_object('id',b.id,'email',p.email,'entries',rows);
end $$;
create or replace function public.he_claim_batches() returns jsonb language sql security invoker set search_path='' as $$ select private.he_claim_batches() $$;
create or replace function public.he_prepare_batch(p_batch_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.he_prepare_batch(p_batch_id) $$;
create or replace function public.he_complete_batch(p_batch_id uuid,p_result text,p_provider_id text default null) returns void language sql security invoker set search_path='' as $$ select private.he_complete_batch(p_batch_id,p_result,p_provider_id) $$;

-- Fecha o acesso padrão PUBLIC, inclusive nas funções privadas auxiliares.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and p.proname in ('submit_entry_v4','revise_entry_v4','admin_set_profile_v2','he_reminder_start','he_normalize_recipient','he_require_service','he_claim_batches','he_prepare_batch','he_complete_batch') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  if f.proname in ('submit_entry_v4','revise_entry_v4','admin_set_profile_v2') then execute format('grant execute on function %s to authenticated',f.signature);
  elsif f.proname in ('he_claim_batches','he_prepare_batch','he_complete_batch','he_require_service') then execute format('grant execute on function %s to service_role',f.signature); end if;
 end loop;
end $$;
grant usage on schema private to service_role;

-- Diagnóstico sem enviar e sem alterar lotes. Somente a função de servidor pode chamar.
create or replace function private.he_reminder_health() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.he_require_service();
 return jsonb_build_object('recipients',(select count(*) from public.profiles where role='supervisor' and active and approval_status='approved' and can_approve and receive_he_reminders),'overdue',(select count(*) from public.overtime_entries where status='pending' and reminder_started_at<now()-interval '48 hours'));
end $$;
create or replace function public.he_reminder_health() returns jsonb language sql security invoker set search_path='' as $$select private.he_reminder_health()$$;
revoke all on function private.he_reminder_health(),public.he_reminder_health() from public,anon,authenticated;
grant execute on function private.he_reminder_health(),public.he_reminder_health() to service_role;

notify pgrst,'reload schema';
commit;
-- Deve exibir os novos campos, sem alterar os lançamentos.
select column_name,data_type from information_schema.columns where table_schema='public' and table_name='overtime_entries' and column_name in ('location','glpi','reminder_started_at');
