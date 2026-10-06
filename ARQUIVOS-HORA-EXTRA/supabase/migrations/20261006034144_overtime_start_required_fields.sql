-- Horário separado de início da hora extra. PostgreSQL 17.
-- Não apaga, preenche nem altera os dados de lançamentos existentes.
-- As funções antigas são mantidas para compatibilidade durante a atualização do site.
begin;
set local lock_timeout = '5s';
lock table public.overtime_entries in access exclusive mode;

create temporary table overtime_upgrade_snapshot on commit drop as
select count(*) as entries, coalesce(sum(minutes), 0) as total,
  md5(coalesce(string_agg((to_jsonb(e) - 'overtime_start')::text, '|' order by id), '')) as digest
from public.overtime_entries e;

alter table public.overtime_entries add column if not exists overtime_start time;
comment on column public.overtime_entries.overtime_start is
  'Início efetivo da hora extra. Nulo apenas em registros do fluxo anterior.';

alter table public.overtime_entries alter column minutes set expression as (
  (extract(epoch from (
    ((work_date + final_exit) + case when final_exit_next_day then interval '1 day' else interval '0 day' end)
    - (work_date + coalesce(overtime_start, point_exit))
  )) / 60)::integer
);

alter table public.overtime_entries drop constraint if exists valid_overtime;
alter table public.overtime_entries add constraint valid_overtime check (
  (extract(epoch from (
    ((work_date + final_exit) + case when final_exit_next_day then interval '1 day' else interval '0 day' end)
    - (work_date + coalesce(overtime_start, point_exit))
  )) / 60) between 1 and 960
);

alter table public.overtime_entries drop constraint if exists overtime_required_information;
alter table public.overtime_entries add constraint overtime_required_information check (
  overtime_start is null or (
    normal_entry is not null and note ~ '[^[:space:]]' and overtime_start >= point_exit
    and normal_entry < time '24:00' and point_exit < time '24:00'
    and overtime_start < time '24:00' and final_exit < time '24:00'
  )
);

create or replace function private.validate_overtime_input(
  p_work_date date, p_normal_entry time, p_point_exit time, p_overtime_start time,
  p_final_exit time, p_final_exit_next_day boolean, p_note text)
returns void language plpgsql security invoker set search_path = '' as $$
declare total numeric;
begin
  if p_work_date is null or p_normal_entry is null or p_point_exit is null
    or p_overtime_start is null or p_final_exit is null or p_final_exit_next_day is null then
    raise exception 'Preencha a data e todos os horarios do lancamento';
  end if;
  if p_note is null or p_note !~ '[^[:space:]]' or length(trim(p_note)) > 1000 then
    raise exception 'Preencha a descricao do servico (ate 1000 caracteres)';
  end if;
  if p_normal_entry >= time '24:00' or p_point_exit >= time '24:00'
    or p_overtime_start >= time '24:00' or p_final_exit >= time '24:00'
    or extract(second from p_normal_entry) <> 0 or extract(second from p_point_exit) <> 0
    or extract(second from p_overtime_start) <> 0 or extract(second from p_final_exit) <> 0 then
    raise exception 'Informe horarios validos com horas e minutos';
  end if;
  if p_overtime_start < p_point_exit then
    raise exception 'O inicio da hora extra deve ser igual ou posterior a saida normal';
  end if;
  total := extract(epoch from (
    (p_work_date + p_final_exit + case when p_final_exit_next_day then interval '1 day' else interval '0 day' end)
    - (p_work_date + p_overtime_start)
  )) / 60;
  if total < 1 or total > 960 then
    raise exception 'Confira os horarios: a hora extra deve durar de 1 minuto a 16 horas';
  end if;
end $$;

create or replace function private.submit_entry_v2(
  p_work_date date, p_normal_entry time, p_point_exit time, p_overtime_start time,
  p_final_exit time, p_final_exit_next_day boolean, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not (select private.is_active_user())
    or not exists(select 1 from public.profiles where id = (select auth.uid())
      and role = 'maintainer' and approval_status = 'approved') then
    raise exception 'Use um acesso de manutentor autorizado para registrar horas';
  end if;
  perform private.validate_overtime_input(p_work_date, p_normal_entry, p_point_exit,
    p_overtime_start, p_final_exit, p_final_exit_next_day, p_note);
  insert into public.overtime_entries(worker_id, work_date, normal_entry, point_exit,
    overtime_start, final_exit, final_exit_next_day, note)
  values ((select auth.uid()), p_work_date, p_normal_entry, p_point_exit,
    p_overtime_start, p_final_exit, p_final_exit_next_day, trim(p_note));
end $$;

create or replace function private.revise_entry_v2(
  p_entry_id uuid, p_work_date date, p_normal_entry time, p_point_exit time, p_overtime_start time,
  p_final_exit time, p_final_exit_next_day boolean, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare rec public.overtime_entries%rowtype;
begin
  if (select auth.uid()) is null or not (select private.is_active_user())
    or not exists(select 1 from public.profiles where id = (select auth.uid()) and approval_status = 'approved') then
    raise exception 'Usuario nao autorizado';
  end if;
  select * into rec from public.overtime_entries where id = p_entry_id for update;
  if not found or rec.worker_id <> (select auth.uid()) or rec.status <> 'rejected' then
    raise exception 'Somente o autor pode corrigir um lancamento devolvido';
  end if;
  perform private.validate_overtime_input(p_work_date, p_normal_entry, p_point_exit,
    p_overtime_start, p_final_exit, p_final_exit_next_day, p_note);
  update public.overtime_entries set work_date = p_work_date, normal_entry = p_normal_entry,
    point_exit = p_point_exit, overtime_start = p_overtime_start,
    final_exit = p_final_exit, final_exit_next_day = p_final_exit_next_day,
    note = trim(p_note), status = 'pending', rejection_reason = null,
    reviewed_by = null, reviewed_at = null, submitted_at = now()
  where id = p_entry_id;
end $$;

-- A API pública conserva SECURITY INVOKER. A autorização fica no esquema privado.
create or replace function public.submit_entry_v2(
  p_work_date date, p_normal_entry time, p_point_exit time, p_overtime_start time,
  p_final_exit time, p_final_exit_next_day boolean, p_note text)
returns void language sql security invoker set search_path = '' as $$
  select private.submit_entry_v2(p_work_date, p_normal_entry, p_point_exit,
    p_overtime_start, p_final_exit, p_final_exit_next_day, p_note)
$$;
create or replace function public.revise_entry_v2(
  p_entry_id uuid, p_work_date date, p_normal_entry time, p_point_exit time, p_overtime_start time,
  p_final_exit time, p_final_exit_next_day boolean, p_note text)
returns void language sql security invoker set search_path = '' as $$
  select private.revise_entry_v2(p_entry_id, p_work_date, p_normal_entry, p_point_exit,
    p_overtime_start, p_final_exit, p_final_exit_next_day, p_note)
$$;

revoke all on function private.validate_overtime_input(date,time,time,time,time,boolean,text) from public, anon, authenticated;
revoke all on function private.submit_entry_v2(date,time,time,time,time,boolean,text) from public, anon;
revoke all on function private.revise_entry_v2(uuid,date,time,time,time,time,boolean,text) from public, anon;
revoke all on function public.submit_entry_v2(date,time,time,time,time,boolean,text) from public, anon;
revoke all on function public.revise_entry_v2(uuid,date,time,time,time,time,boolean,text) from public, anon;
grant execute on function private.submit_entry_v2(date,time,time,time,time,boolean,text) to authenticated;
grant execute on function private.revise_entry_v2(uuid,date,time,time,time,time,boolean,text) to authenticated;
grant execute on function public.submit_entry_v2(date,time,time,time,time,boolean,text) to authenticated;
grant execute on function public.revise_entry_v2(uuid,date,time,time,time,time,boolean,text) to authenticated;

-- Interromper toda a migração se os dados anteriores mudarem inesperadamente.
do $$
declare before_row record; after_row record;
begin
  select * into before_row from overtime_upgrade_snapshot;
  select count(*) as entries, coalesce(sum(minutes), 0) as total,
    md5(coalesce(string_agg((to_jsonb(e) - 'overtime_start')::text, '|' order by id), '')) as digest
  into after_row from public.overtime_entries e;
  if before_row.entries <> after_row.entries or before_row.total <> after_row.total
    or before_row.digest <> after_row.digest then
    raise exception 'Verificacao dos registros anteriores falhou; nenhuma alteracao foi aplicada';
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
