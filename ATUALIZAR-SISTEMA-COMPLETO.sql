-- ATUALIZAÇÃO COMPLETA: execute apenas no projeto que já está em uso.
-- Nenhuma hora, conta, permissão, histórico ou preferência existente é reescrita.
begin;
set local lock_timeout='8s';
lock table public.overtime_entries in share row exclusive mode;
create temporary table he_mega_before on commit drop as
select id,to_jsonb(e)-array['workflow_version','activities','participants','attachments'] as data from public.overtime_entries e;
create temporary table he_profiles_before on commit drop as
select id,to_jsonb(p)-'he_reminder_delay_hours' as data from public.profiles p;

alter table public.overtime_entries add column if not exists workflow_version integer not null default 1;
alter table public.overtime_entries add column if not exists activities jsonb not null default '[]';
alter table public.overtime_entries add column if not exists participants jsonb not null default '[]';
alter table public.overtime_entries add column if not exists attachments jsonb not null default '[]';
alter table public.profiles add column if not exists he_reminder_delay_hours smallint not null default 48 check(he_reminder_delay_hours in (24,48));
comment on column public.overtime_entries.workflow_version is '1: registro anterior preservado; 2: novo fluxo com atividades e campos obrigatórios';

create or replace function private.he_validate_detail(e public.overtime_entries) returns void
language plpgsql set search_path='' as $$
declare a jsonb; cursor_min int; finish_min int; start_min int; stop_min int;
begin
 if e.workflow_version<>2 then return; end if;
 if nullif(btrim(coalesce(e.location,'')),'') is null or nullif(btrim(coalesce(e.glpi,'')),'') is null then raise exception 'Localizacao e GLPI sao obrigatorios nos novos lancamentos'; end if;
 if jsonb_typeof(e.activities)<>'array' or jsonb_array_length(e.activities) not between 1 and 20 then raise exception 'Informe de 1 a 20 atividades'; end if;
 cursor_min:=extract(epoch from e.overtime_start)::int/60;
 finish_min:=extract(epoch from e.final_exit)::int/60 + case when e.final_exit_next_day then 1440 else 0 end;
 for a in select value from jsonb_array_elements(e.activities) loop
  if a->>'start' is null or a->>'end' is null or a->>'start' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or a->>'end' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
   or jsonb_typeof(a->'start_next_day') is distinct from 'boolean' or jsonb_typeof(a->'end_next_day') is distinct from 'boolean'
   or jsonb_typeof(a->'description') is distinct from 'string' or length(btrim(a->>'description')) not between 1 and 300 or not (a->>'description' ~ '[^[:space:]]') then raise exception 'Confira horarios, dias e descricao de cada atividade'; end if;
  start_min:=extract(epoch from (a->>'start')::time)::int/60 + case when (a->>'start_next_day')::boolean then 1440 else 0 end;
  stop_min:=extract(epoch from (a->>'end')::time)::int/60 + case when (a->>'end_next_day')::boolean then 1440 else 0 end;
  if start_min<>cursor_min or stop_min<=start_min or stop_min>finish_min then raise exception 'As atividades devem cobrir toda a extra, em ordem, sem lacunas ou sobreposicao'; end if;
  cursor_min:=stop_min;
 end loop;
 if cursor_min<>finish_min then raise exception 'Detalhe as atividades ate o termino da hora extra'; end if;
end $$;
create or replace function private.he_detail_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then new.workflow_version:=2; else new.workflow_version:=old.workflow_version; end if;
 perform private.he_validate_detail(new);
 return new;
end $$;
drop trigger if exists he_detailed_guard on public.overtime_entries;
create trigger he_detailed_guard before insert or update on public.overtime_entries for each row execute function private.he_detail_guard();

-- Nomes selecionáveis sem divulgar e-mails, permissões ou horas de outros usuários.
create or replace function private.he_coworkers() returns table(id uuid,full_name text)
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and p.approval_status='approved') then raise exception 'Acesso nao autorizado' using errcode='42501'; end if;
 return query select p.id,p.full_name from public.profiles p where p.role='maintainer' and p.active and p.approval_status='approved' order by p.full_name,p.id;
end $$;
create or replace function public.he_coworkers() returns table(id uuid,full_name text)
language sql security invoker set search_path='' as $$select * from private.he_coworkers()$$;

create or replace function private.he_participants(p_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if (select auth.uid()) is null then raise exception 'Acesso nao autorizado'; end if;
 if cardinality(coalesce(p_ids,'{}'))>20 or exists(select 1 from unnest(p_ids) x where x is null or x=(select auth.uid())) or cardinality(p_ids)<>(select count(distinct x) from unnest(p_ids) x) then raise exception 'Confira os participantes selecionados'; end if;
 if exists(select 1 from unnest(p_ids) x where not exists(select 1 from public.profiles p where p.id=x and p.role='maintainer' and p.active and p.approval_status='approved')) then raise exception 'Um participante selecionado nao esta mais disponivel'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name) order by p.full_name,p.id),'[]') into result from public.profiles p where p.id=any(p_ids);
 return result;
end $$;

-- Bucket privado: URLs assinadas somente para quem pode consultar o lançamento.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('he-service-media','he-service-media',false,20971520,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create or replace function private.he_media_reader(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and p.approval_status='approved' and (
  p.role='admin' or (p.role='maintainer' and split_part(p_path,'/',1)=p.id::text)
  or (p.role in ('admin','supervisor','analyst') and exists(select 1 from public.overtime_entries e where e.attachments @> jsonb_build_array(jsonb_build_object('path',p_path))))
 ))
$$;
create or replace function private.he_media_unlinked(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and p.approval_status='approved' and (p.role='admin' or p.role='admin' or (p.role='maintainer' and split_part(p_path,'/',1)=p.id::text)))
 and not exists(select 1 from public.overtime_entries e where e.attachments @> jsonb_build_array(jsonb_build_object('path',p_path)))
$$;
create index if not exists he_attachments_paths_idx on public.overtime_entries using gin(attachments jsonb_path_ops);
drop policy if exists he_media_select on storage.objects;
create policy he_media_select on storage.objects for select to authenticated using(bucket_id='he-service-media' and private.he_media_reader(name));
drop policy if exists he_media_insert on storage.objects;
create policy he_media_insert on storage.objects for insert to authenticated with check(bucket_id='he-service-media'
 and name ~ ('^'||(select auth.uid())::text||'/[a-f0-9-]{36}/[a-f0-9-]{36}[.](jpg|png|webp|gif|mp4|webm|mov)$')
 and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and p.approval_status='approved' and p.role='maintainer')
 and private.he_media_unlinked(name));
drop policy if exists he_media_delete on storage.objects;
create policy he_media_delete on storage.objects for delete to authenticated using(bucket_id='he-service-media' and private.he_media_unlinked(name));

create or replace function private.he_validate_attachments(p_items jsonb,p_previous jsonb default '[]') returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb; result jsonb:='[]'; obj record;
begin
 if (select auth.uid()) is null then raise exception 'Acesso nao autorizado'; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>5 then raise exception 'Use no maximo 5 anexos'; end if;
 if (select count(*) from jsonb_array_elements(p_items))<>(select count(distinct value->>'path') from jsonb_array_elements(p_items)) then raise exception 'Anexo repetido'; end if;
 for a in select value from jsonb_array_elements(p_items) loop
  if p_previous @> jsonb_build_array(a) then result:=result||jsonb_build_array(a); continue; end if;
  if a->>'path' is null or a->>'path' !~ ('^'||(select auth.uid())::text||'/[a-f0-9-]{36}/[a-f0-9-]{36}[.](jpg|png|webp|gif|mp4|webm|mov)$') then raise exception 'Anexo nao autorizado'; end if;
  select metadata into obj from storage.objects where bucket_id='he-service-media' and name=a->>'path';
  if not found or a->>'name' is null or length(a->>'name') not between 1 and 200 or jsonb_typeof(a->'size') is distinct from 'number'
   or a->>'mime' is null or a->>'mime' not in ('image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime')
   or (a->>'size')::numeric not between 1 and 20971520 or (a->>'size')::numeric<>coalesce((obj.metadata->>'size')::numeric,-1)
   or a->>'mime' is distinct from obj.metadata->>'mimetype' then raise exception 'Confira tipo, tamanho e envio do anexo'; end if;
  result:=result||jsonb_build_array(jsonb_build_object('path',a->>'path','name',a->>'name','mime',a->>'mime','size',(a->>'size')::bigint));
 end loop;
 return result;
end $$;

create or replace function private.submit_entry_v5(p_request_id uuid,p_work_date date,p_normal_entry time,p_point_exit time,p_overtime_start time,p_final_exit time,p_final_exit_next_day boolean,p_note text,p_is_holiday boolean,p_location text,p_glpi text,p_activities jsonb,p_helper_ids uuid[],p_attachments jsonb)
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
 perform private.validate_overtime_input_v3(p_work_date,p_normal_entry,p_point_exit,p_overtime_start,p_final_exit,p_final_exit_next_day,p_note,p_is_holiday);
 people:=private.he_participants(coalesce(p_helper_ids,'{}')); media:=private.he_validate_attachments(p_attachments);
 insert into public.overtime_entries(id,worker_id,work_date,normal_entry,point_exit,overtime_start,final_exit,final_exit_next_day,note,is_holiday,location,glpi,activities,participants,attachments)
 values(p_request_id,(select auth.uid()),p_work_date,case when p_is_holiday then null else p_normal_entry end,case when p_is_holiday then null else p_point_exit end,p_overtime_start,p_final_exit,p_final_exit_next_day,btrim(p_note),p_is_holiday,nullif(btrim(p_location),''),nullif(btrim(p_glpi),''),p_activities,people,media);
 return p_request_id;
end $$;
create or replace function private.revise_entry_v5(p_entry_id uuid,p_work_date date,p_normal_entry time,p_point_exit time,p_overtime_start time,p_final_exit time,p_final_exit_next_day boolean,p_note text,p_is_holiday boolean,p_location text,p_glpi text,p_activities jsonb,p_helper_ids uuid[],p_attachments jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare rec public.overtime_entries%rowtype; people jsonb; media jsonb;
begin
 if not exists(select 1 from public.profiles where id=(select auth.uid()) and active and approval_status='approved' and role='maintainer') then raise exception 'Use um acesso de manutentor autorizado'; end if;
 select * into rec from public.overtime_entries where id=p_entry_id for update;
 if not found or rec.worker_id<>(select auth.uid()) or rec.status<>'rejected' then raise exception 'Somente o autor pode corrigir um lancamento devolvido'; end if;
 perform private.validate_overtime_input_v3(p_work_date,p_normal_entry,p_point_exit,p_overtime_start,p_final_exit,p_final_exit_next_day,p_note,p_is_holiday);
 -- Participantes históricos desativados são mantidos se a seleção não mudou.
 if coalesce(p_helper_ids,'{}') @> array(select (value->>'id')::uuid from jsonb_array_elements(rec.participants))
  and coalesce(p_helper_ids,'{}') <@ array(select (value->>'id')::uuid from jsonb_array_elements(rec.participants)) then people:=rec.participants;
 else people:=private.he_participants(coalesce(p_helper_ids,'{}')); end if;
 media:=private.he_validate_attachments(p_attachments,rec.attachments);
 update public.overtime_entries set work_date=p_work_date,normal_entry=case when p_is_holiday then null else p_normal_entry end,point_exit=case when p_is_holiday then null else p_point_exit end,overtime_start=p_overtime_start,final_exit=p_final_exit,final_exit_next_day=p_final_exit_next_day,note=btrim(p_note),is_holiday=p_is_holiday,location=nullif(btrim(p_location),''),glpi=nullif(btrim(p_glpi),''),activities=case when rec.workflow_version=2 then p_activities else rec.activities end,participants=people,attachments=media,status='pending',rejection_reason=null,reviewed_by=null,reviewed_at=null,submitted_at=now() where id=p_entry_id;
 return p_entry_id;
end $$;
create or replace function public.submit_entry_v5(p_request_id uuid,p_work_date date,p_normal_entry time,p_point_exit time,p_overtime_start time,p_final_exit time,p_final_exit_next_day boolean,p_note text,p_is_holiday boolean,p_location text,p_glpi text,p_activities jsonb,p_helper_ids uuid[],p_attachments jsonb)
returns uuid language sql security invoker set search_path='' as $$select private.submit_entry_v5(p_request_id,p_work_date,p_normal_entry,p_point_exit,p_overtime_start,p_final_exit,p_final_exit_next_day,p_note,p_is_holiday,p_location,p_glpi,p_activities,p_helper_ids,p_attachments)$$;
create or replace function public.revise_entry_v5(p_entry_id uuid,p_work_date date,p_normal_entry time,p_point_exit time,p_overtime_start time,p_final_exit time,p_final_exit_next_day boolean,p_note text,p_is_holiday boolean,p_location text,p_glpi text,p_activities jsonb,p_helper_ids uuid[],p_attachments jsonb)
returns uuid language sql security invoker set search_path='' as $$select private.revise_entry_v5(p_entry_id,p_work_date,p_normal_entry,p_point_exit,p_overtime_start,p_final_exit,p_final_exit_next_day,p_note,p_is_holiday,p_location,p_glpi,p_activities,p_helper_ids,p_attachments)$$;

create or replace function private.admin_set_profile_v3(p_target uuid,p_role text,p_active boolean,p_can_approve boolean,p_can_export boolean,p_full_name text,p_receive_he_reminders boolean,p_delay_hours integer)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not (select private.is_admin()) then raise exception 'Somente o administrador pode alterar usuarios'; end if;
 if p_delay_hours is null or p_delay_hours not in (24,48) then raise exception 'Escolha um prazo de 24 ou 48 horas'; end if;
 perform private.admin_set_profile_v2(p_target,p_role,p_active,p_can_approve,p_can_export,p_full_name,p_receive_he_reminders);
 update public.profiles set he_reminder_delay_hours=p_delay_hours where id=p_target;
end $$;
create or replace function public.admin_set_profile_v3(p_target uuid,p_role text,p_active boolean,p_can_approve boolean,p_can_export boolean,p_full_name text,p_receive_he_reminders boolean,p_delay_hours integer)
returns void language sql security invoker set search_path='' as $$select private.admin_set_profile_v3(p_target,p_role,p_active,p_can_approve,p_can_export,p_full_name,p_receive_he_reminders,p_delay_hours)$$;

-- Lembretes antigos continuam em 48h; novos usam a configuração por gestor.
create or replace function private.he_claim_batches() returns jsonb language plpgsql security definer set search_path='' as $$
declare p record; b record; items jsonb; answer jsonb:='[]'::jsonb;
begin
 perform private.he_require_service();
 -- A transação serializa a montagem. O envio só ocorre depois, fora do bloqueio.
 perform pg_advisory_xact_lock(72548019);
 for b in select id from private.he_reminder_batches where status='sending' and attempted_at<now()-interval '15 minutes' loop
  perform private.he_complete_batch(b.id,'unknown',null);
 end loop;
 for p in select id,he_reminder_delay_hours from public.profiles where role='supervisor' and active and approval_status='approved' and can_approve and receive_he_reminders order by id loop
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
   where e.status='pending' and e.reminder_started_at<now()-(case when e.workflow_version=2 then p.he_reminder_delay_hours else 48 end)*interval '1 hour'
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
 select jsonb_agg(jsonb_build_object('id',e.id,'worker',w.full_name,'work_date',e.work_date,'minutes',e.minutes,'location',e.location,'glpi',e.glpi,'started_at',e.reminder_started_at,'delay_hours',case when e.workflow_version=2 then p.he_reminder_delay_hours else 48 end) order by e.reminder_started_at,e.id) into rows
 from jsonb_to_recordset(b.items) as i(id uuid,started_at timestamptz)
 join public.overtime_entries e on e.id=i.id and e.reminder_started_at=i.started_at
 join public.profiles w on w.id=e.worker_id
 where e.status='pending' and e.reminder_started_at<now()-(case when e.workflow_version=2 then p.he_reminder_delay_hours else 48 end)*interval '1 hour'
 and not exists(select 1 from private.he_reminder_receipts r where r.recipient_id=p.id and r.entry_id=e.id and r.started_at=e.reminder_started_at and r.last_sent_at>now()-interval '24 hours');
 if rows is null then update private.he_reminder_batches set status='cancelled',completed_at=now() where id=b.id; return null; end if;
 update private.he_reminder_batches set status='sending',attempted_at=now() where id=b.id;
 return jsonb_build_object('id',b.id,'email',p.email,'entries',rows);
end $$;

create or replace function private.he_reminder_health() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.he_require_service();
 return jsonb_build_object('recipients',(select count(*) from public.profiles where role='supervisor' and active and approval_status='approved' and can_approve and receive_he_reminders),
 'overdue',(select count(*) from public.overtime_entries e where e.status='pending' and exists(select 1 from public.profiles p where p.role='supervisor' and p.active and p.approval_status='approved' and p.can_approve and p.receive_he_reminders and e.reminder_started_at<now()-(case when e.workflow_version=2 then p.he_reminder_delay_hours else 48 end)*interval '1 hour')));
end $$;

-- Restrição explícita: as funções públicas são invoker, as privilegiadas ficam em private.
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname in
 ('he_validate_detail','he_detail_guard','he_coworkers','he_participants','he_media_reader','he_media_unlinked','he_validate_attachments','submit_entry_v5','revise_entry_v5','admin_set_profile_v3') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  if f.proname in ('he_coworkers','he_media_reader','he_media_unlinked','submit_entry_v5','revise_entry_v5','admin_set_profile_v3') then execute format('grant execute on function %s to authenticated',f.signature); end if;
 end loop;
end $$;
-- Falhar e reverter tudo se os registros existentes tiverem sido alterados.
do $$ begin
 if exists(select 1 from he_mega_before b full join public.overtime_entries e on e.id=b.id where b.id is null or e.id is null or b.data is distinct from to_jsonb(e)-array['workflow_version','activities','participants','attachments']) then raise exception 'Os registros antigos mudaram; atualizacao revertida'; end if;
 if exists(select 1 from he_profiles_before b full join public.profiles p on p.id=b.id where b.id is null or p.id is null or b.data is distinct from to_jsonb(p)-'he_reminder_delay_hours') then raise exception 'Os acessos antigos mudaram; atualizacao revertida'; end if;
end $$;
notify pgrst,'reload schema';
commit;
select 'Atualizacao concluida; registros antigos preservados' as resultado;
