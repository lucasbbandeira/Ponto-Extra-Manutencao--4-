-- Execute este arquivo inteiro uma vez no SQL Editor do projeto já existente.
-- Não apaga nem reescreve horas, descrições, atividades antigas, usuários ou lembretes.
begin;
set local lock_timeout='8s';
lock table public.overtime_entries in share row exclusive mode;
create temporary table he_simple_before on commit drop as
select id,to_jsonb(e)-'overtime_only' as data from public.overtime_entries e;
alter table public.overtime_entries add column if not exists overtime_only boolean not null default false;
comment on column public.overtime_entries.workflow_version is '1: registro anterior; 2: detalhamento historico; 3: cadastro simplificado com local e GLPI obrigatorios';
comment on column public.overtime_entries.overtime_only is 'Somente hora extra: ponto normal dispensado, sem classificar o dia como feriado';
-- A mesma proteção de horários existente, estendida à nova opção.
alter table public.overtime_entries drop constraint if exists overtime_required_information;
alter table public.overtime_entries add constraint overtime_required_information check (
 ((is_holiday or overtime_only) and normal_entry is null and point_exit is null and overtime_start is not null
  and note ~ '[^[:space:]]' and overtime_start < time '24:00' and final_exit < time '24:00')
 or
 ((not (is_holiday or overtime_only)) and point_exit is not null and (overtime_start is null or
  (normal_entry is not null and note ~ '[^[:space:]]' and overtime_start >= point_exit
   and normal_entry < time '24:00' and point_exit < time '24:00'
   and overtime_start < time '24:00' and final_exit < time '24:00')))
);
create or replace function private.he_validate_detail(e public.overtime_entries) returns void
language plpgsql set search_path='' as $$
begin
 if e.workflow_version<2 then return; end if;
 if nullif(btrim(coalesce(e.location,'')),'') is null or nullif(btrim(coalesce(e.glpi,'')),'') is null then raise exception 'Localizacao e GLPI sao obrigatorios nos novos lancamentos'; end if;
end $$;
create or replace function private.he_detail_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then new.workflow_version:=3; else new.workflow_version:=old.workflow_version; end if;
 perform private.he_validate_detail(new);
 return new;
end $$;
create or replace function private.submit_entry_v6(p_request_id uuid,p_work_date date,p_normal_entry time,p_point_exit time,p_overtime_start time,p_final_exit time,p_final_exit_next_day boolean,p_note text,p_is_holiday boolean,p_location text,p_glpi text,p_activities jsonb,p_helper_ids uuid[],p_attachments jsonb,p_overtime_only boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare rec public.overtime_entries%rowtype; people jsonb; media jsonb;
begin
 if not exists(select 1 from public.profiles where id=(select auth.uid()) and active and approval_status='approved' and role='maintainer') then raise exception 'Use um acesso de manutentor autorizado'; end if;
 if p_request_id is null then raise exception 'Identificacao do envio ausente'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into rec from public.overtime_entries where id=p_request_id;
 if found then
  if rec.worker_id<>(select auth.uid()) then raise exception 'Identificacao indisponivel'; end if;
  return rec.id; -- Repetir o mesmo envio após falha de rede não duplica horas.
 end if;
 if p_overtime_only is null then raise exception 'Confira a opcao somente hora extra'; end if;
 perform private.validate_overtime_input_v3(p_work_date,p_normal_entry,p_point_exit,p_overtime_start,p_final_exit,p_final_exit_next_day,p_note,(p_is_holiday or p_overtime_only));
 people:=private.he_participants(coalesce(p_helper_ids,'{}')); media:=private.he_validate_attachments(p_attachments);
 insert into public.overtime_entries(id,worker_id,work_date,normal_entry,point_exit,overtime_start,final_exit,final_exit_next_day,note,is_holiday,location,glpi,activities,participants,attachments,overtime_only)
 values(p_request_id,(select auth.uid()),p_work_date,case when (p_is_holiday or p_overtime_only) then null else p_normal_entry end,case when (p_is_holiday or p_overtime_only) then null else p_point_exit end,p_overtime_start,p_final_exit,p_final_exit_next_day,btrim(p_note),p_is_holiday,nullif(btrim(p_location),''),nullif(btrim(p_glpi),''),'[]'::jsonb,people,media,p_overtime_only);
 return p_request_id;
end $$;
create or replace function private.revise_entry_v6(p_entry_id uuid,p_work_date date,p_normal_entry time,p_point_exit time,p_overtime_start time,p_final_exit time,p_final_exit_next_day boolean,p_note text,p_is_holiday boolean,p_location text,p_glpi text,p_activities jsonb,p_helper_ids uuid[],p_attachments jsonb,p_overtime_only boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare rec public.overtime_entries%rowtype; people jsonb; media jsonb;
begin
 if not exists(select 1 from public.profiles where id=(select auth.uid()) and active and approval_status='approved' and role='maintainer') then raise exception 'Use um acesso de manutentor autorizado'; end if;
 select * into rec from public.overtime_entries where id=p_entry_id for update;
 if not found or rec.worker_id<>(select auth.uid()) or rec.status<>'rejected' then raise exception 'Somente o autor pode corrigir um lancamento devolvido'; end if;
 if p_overtime_only is null then raise exception 'Confira a opcao somente hora extra'; end if;
 perform private.validate_overtime_input_v3(p_work_date,p_normal_entry,p_point_exit,p_overtime_start,p_final_exit,p_final_exit_next_day,p_note,(p_is_holiday or p_overtime_only));
 -- Participantes históricos desativados são mantidos se a seleção não mudou.
 if coalesce(p_helper_ids,'{}') @> array(select (value->>'id')::uuid from jsonb_array_elements(rec.participants))
  and coalesce(p_helper_ids,'{}') <@ array(select (value->>'id')::uuid from jsonb_array_elements(rec.participants)) then people:=rec.participants;
 else people:=private.he_participants(coalesce(p_helper_ids,'{}')); end if;
 media:=private.he_validate_attachments(p_attachments,rec.attachments);
 update public.overtime_entries set work_date=p_work_date,normal_entry=case when (p_is_holiday or p_overtime_only) then null else p_normal_entry end,point_exit=case when (p_is_holiday or p_overtime_only) then null else p_point_exit end,overtime_start=p_overtime_start,final_exit=p_final_exit,final_exit_next_day=p_final_exit_next_day,note=btrim(p_note),is_holiday=p_is_holiday,overtime_only=p_overtime_only,location=nullif(btrim(p_location),''),glpi=nullif(btrim(p_glpi),''),activities=rec.activities,participants=people,attachments=media,status='pending',rejection_reason=null,reviewed_by=null,reviewed_at=null,submitted_at=now() where id=p_entry_id;
 return p_entry_id;
end $$;
create or replace function public.submit_entry_v6(p_request_id uuid,p_work_date date,p_normal_entry time,p_point_exit time,p_overtime_start time,p_final_exit time,p_final_exit_next_day boolean,p_note text,p_is_holiday boolean,p_location text,p_glpi text,p_activities jsonb,p_helper_ids uuid[],p_attachments jsonb,p_overtime_only boolean)
returns uuid language sql security invoker set search_path='' as $$select private.submit_entry_v6(p_request_id,p_work_date,p_normal_entry,p_point_exit,p_overtime_start,p_final_exit,p_final_exit_next_day,p_note,p_is_holiday,p_location,p_glpi,p_activities,p_helper_ids,p_attachments,p_overtime_only)$$;
create or replace function public.revise_entry_v6(p_entry_id uuid,p_work_date date,p_normal_entry time,p_point_exit time,p_overtime_start time,p_final_exit time,p_final_exit_next_day boolean,p_note text,p_is_holiday boolean,p_location text,p_glpi text,p_activities jsonb,p_helper_ids uuid[],p_attachments jsonb,p_overtime_only boolean)
returns uuid language sql security invoker set search_path='' as $$select private.revise_entry_v6(p_entry_id,p_work_date,p_normal_entry,p_point_exit,p_overtime_start,p_final_exit,p_final_exit_next_day,p_note,p_is_holiday,p_location,p_glpi,p_activities,p_helper_ids,p_attachments,p_overtime_only)$$;


-- Mantém o padrão de autorização do sistema: funções privilegiadas apenas no schema privado.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and p.proname in ('submit_entry_v6','revise_entry_v6') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end $$;
do $$ begin
 if exists(select 1 from he_simple_before b full join public.overtime_entries e on e.id=b.id
 where b.id is null or e.id is null or b.data is distinct from to_jsonb(e)-'overtime_only') then
 raise exception 'Registros antigos mudaram; atualizacao revertida'; end if;
end $$;
notify pgrst,'reload schema';
commit;
select 'Cadastro simplificado atualizado. Registros anteriores preservados.' as resultado;
