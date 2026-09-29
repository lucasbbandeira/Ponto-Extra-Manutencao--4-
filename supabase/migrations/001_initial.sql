-- Execute este arquivo uma vez no SQL Editor do projeto Supabase.
-- Todo horario abaixo e local da unidade (America/Sao_Paulo).
create schema if not exists private;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique check (email = lower(email)),
  full_name text not null check (length(trim(full_name)) between 2 and 120),
  role text not null check (role in ('admin', 'supervisor', 'maintainer')),
  active boolean not null default true,
  can_approve boolean not null default false,
  can_export boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint permissions_for_management check (
    role <> 'maintainer' or (not can_approve and not can_export)
  )
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  full_name text not null check (length(trim(full_name)) between 2 and 120),
  role text not null check (role in ('admin', 'supervisor', 'maintainer')),
  status text not null default 'pending' check (status in ('pending', 'claimed', 'revoked')),
  invited_by uuid references public.profiles(id) on delete set null,
  claimed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);

create table public.overtime_entries (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.profiles(id),
  work_date date not null,
  normal_entry time,
  point_exit time not null,
  final_exit time not null,
  final_exit_next_day boolean not null default false,
  minutes integer generated always as (
    (extract(epoch from (
      ((work_date + final_exit) + case when final_exit_next_day then interval '1 day' else interval '0 day' end)
      - (work_date + point_exit)
    )) / 60)::integer
  ) stored,
  note text not null default '' check (length(note) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  rejection_reason text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_overtime check (
    (extract(epoch from (
      ((work_date + final_exit) + case when final_exit_next_day then interval '1 day' else interval '0 day' end)
      - (work_date + point_exit)
    )) / 60) between 1 and 960
  ),
  constraint review_consistency check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null and rejection_reason is null)
    or (status = 'approved' and reviewed_by is not null and reviewed_at is not null and rejection_reason is null)
    or (status = 'rejected' and reviewed_by is not null and reviewed_at is not null
      and rejection_reason is not null and length(trim(rejection_reason)) > 0)
  )
);
create index overtime_worker_date_idx on public.overtime_entries(worker_id, work_date desc);
create index overtime_status_date_idx on public.overtime_entries(status, work_date desc);

create table public.entry_events (
  id bigint generated always as identity primary key,
  entry_id uuid not null references public.overtime_entries(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('submitted', 'approved', 'rejected', 'revised')),
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create index entry_events_entry_idx on public.entry_events(entry_id, created_at desc);

create function private.is_active_user() returns boolean language sql stable security definer
set search_path = '' as $$
  select exists(select 1 from public.profiles where id = (select auth.uid()) and active)
$$;
create function private.is_admin() returns boolean language sql stable security definer
set search_path = '' as $$
  select exists(select 1 from public.profiles where id = (select auth.uid()) and active and role = 'admin')
$$;
create function private.can_view_all() returns boolean language sql stable security definer
set search_path = '' as $$
  select exists(select 1 from public.profiles where id = (select auth.uid()) and active and role in ('admin', 'supervisor'))
$$;
create function private.can_approve_entries() returns boolean language sql stable security definer
set search_path = '' as $$
  select exists(select 1 from public.profiles where id = (select auth.uid()) and active
    and (role = 'admin' or (role = 'supervisor' and can_approve)))
$$;

create function private.set_updated_at() returns trigger language plpgsql
set search_path = '' as $$ begin new.updated_at := now(); return new; end $$;
create trigger profiles_updated before update on public.profiles
for each row execute function private.set_updated_at();
create trigger overtime_updated before update on public.overtime_entries
for each row execute function private.set_updated_at();

-- O cadastro usa somente convites autorizados. O e-mail pertence ao Auth, nao aos metadados do usuario.
create function private.accept_invitation() returns trigger language plpgsql security definer
set search_path = '' as $$
declare invite public.invitations%rowtype;
begin
  select * into invite from public.invitations
  where email = lower(new.email) and status = 'pending' for update;
  if found then
    insert into public.profiles(id, email, full_name, role, can_approve, can_export)
    values (new.id, lower(new.email), invite.full_name, invite.role,
      invite.role in ('admin', 'supervisor'), invite.role in ('admin', 'supervisor'));
    update public.invitations set status = 'claimed', claimed_at = now(), claimed_by = new.id
    where id = invite.id;
  end if;
  return new;
end $$;
create trigger auth_user_invitation after insert on auth.users
for each row execute function private.accept_invitation();

create function private.log_entry_event() returns trigger language plpgsql security definer
set search_path = '' as $$
begin
  insert into public.entry_events(entry_id, actor_id, action, snapshot)
  values (new.id, (select auth.uid()),
    case when tg_op = 'INSERT' then 'submitted'
      when new.status = 'approved' then 'approved'
      when new.status = 'rejected' then 'rejected'
      else 'revised' end,
    to_jsonb(new));
  return new;
end $$;
create trigger overtime_audit after insert or update on public.overtime_entries
for each row execute function private.log_entry_event();

alter table public.profiles enable row level security;
alter table public.invitations enable row level security;
alter table public.overtime_entries enable row level security;
alter table public.entry_events enable row level security;

create policy profiles_read on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select private.can_view_all()));
-- Nenhuma alteracao direta de perfil pelo navegador: somente a funcao admin_set_profile.
create policy invitations_read on public.invitations for select to authenticated
using ((select private.is_admin()));
create policy invitations_insert on public.invitations for insert to authenticated
with check ((select private.is_admin()) and status = 'pending'
  and invited_by = (select auth.uid()) and claimed_by is null and claimed_at is null);
create policy invitations_update on public.invitations for update to authenticated
using ((select private.is_admin())) with check ((select private.is_admin()));
create policy overtime_read on public.overtime_entries for select to authenticated
using (((worker_id = (select auth.uid())) and (select private.is_active_user()))
  or (select private.can_view_all()));
create policy events_read on public.entry_events for select to authenticated
using ((select private.can_view_all()) or exists (
  select 1 from public.overtime_entries e where e.id = entry_id
    and e.worker_id = (select auth.uid()) and (select private.is_active_user())
));

-- A troca de status e atomica; nenhum cliente pode escrever aprovacao diretamente.
create function public.submit_entry(p_work_date date, p_normal_entry time,
  p_point_exit time, p_final_exit time, p_final_exit_next_day boolean, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select private.is_active_user()) then raise exception 'Usuario nao autorizado'; end if;
  if (select role from public.profiles where id = (select auth.uid())) <> 'maintainer' then
    raise exception 'Use o acesso de manutentor para registrar horas';
  end if;
  insert into public.overtime_entries(worker_id, work_date, normal_entry,
    point_exit, final_exit, final_exit_next_day, note)
  values ((select auth.uid()), p_work_date, p_normal_entry, p_point_exit,
    p_final_exit, p_final_exit_next_day, left(coalesce(p_note,''),1000));
end $$;

create function public.review_entry(p_entry_id uuid, p_decision text, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare rec public.overtime_entries%rowtype;
begin
  if not (select private.can_approve_entries()) then raise exception 'Sem permissao para aprovar'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'Decisao invalida'; end if;
  if p_decision = 'rejected' and length(trim(coalesce(p_reason,''))) = 0 then
    raise exception 'Informe o motivo da devolucao';
  end if;
  select * into rec from public.overtime_entries where id = p_entry_id for update;
  if not found or rec.status <> 'pending' then raise exception 'Lancamento nao esta pendente'; end if;
  update public.overtime_entries set status = p_decision,
    reviewed_by = (select auth.uid()), reviewed_at = now(),
    rejection_reason = case when p_decision = 'rejected' then left(trim(p_reason),1000) else null end
  where id = p_entry_id;
end $$;

create function public.revise_entry(p_entry_id uuid, p_work_date date,
  p_normal_entry time, p_point_exit time, p_final_exit time,
  p_final_exit_next_day boolean, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare rec public.overtime_entries%rowtype;
begin
  if not (select private.is_active_user()) then raise exception 'Usuario inativo'; end if;
  select * into rec from public.overtime_entries where id = p_entry_id for update;
  if not found or rec.worker_id <> (select auth.uid()) or rec.status <> 'rejected' then
    raise exception 'Somente o autor pode corrigir um lancamento devolvido';
  end if;
  update public.overtime_entries set work_date = p_work_date, normal_entry = p_normal_entry,
    point_exit = p_point_exit, final_exit = p_final_exit,
    final_exit_next_day = p_final_exit_next_day,
    note = left(coalesce(p_note,''),1000), status = 'pending',
    rejection_reason = null, reviewed_by = null, reviewed_at = null,
    submitted_at = now() where id = p_entry_id;
end $$;

create function public.admin_set_profile(p_target uuid, p_role text, p_active boolean,
  p_can_approve boolean, p_can_export boolean, p_full_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare old_role text;
begin
  if not (select private.is_admin()) then raise exception 'Somente o administrador pode alterar usuarios'; end if;
  if p_role not in ('admin','supervisor','maintainer') then raise exception 'Perfil invalido'; end if;
  if length(trim(coalesce(p_full_name,''))) not between 2 and 120 then raise exception 'Nome invalido'; end if;
  select role into old_role from public.profiles where id = p_target for update;
  if not found then raise exception 'Usuario nao encontrado'; end if;
  if p_target = (select auth.uid()) and (p_role <> 'admin' or not p_active) then
    raise exception 'Nao e possivel remover seu proprio acesso administrativo';
  end if;
  if old_role = 'admin' and (p_role <> 'admin' or not p_active)
    and (select count(*) from public.profiles where role = 'admin' and active) <= 1 then
    raise exception 'Deve existir pelo menos um administrador ativo';
  end if;
  update public.profiles set role = p_role, active = p_active,
    can_approve = case when p_role = 'admin' then true when p_role = 'supervisor' then p_can_approve else false end,
    can_export = case when p_role = 'admin' then true when p_role = 'supervisor' then p_can_export else false end,
    full_name = trim(p_full_name) where id = p_target;
end $$;

revoke all on public.profiles, public.invitations, public.overtime_entries, public.entry_events from anon;
grant select on public.profiles, public.entry_events to authenticated;
grant select, insert, update on public.invitations to authenticated;
grant select on public.overtime_entries to authenticated;
revoke all on function public.submit_entry(date,time,time,time,boolean,text),
  public.review_entry(uuid,text,text),
  public.revise_entry(uuid,date,time,time,time,boolean,text),
  public.admin_set_profile(uuid,text,boolean,boolean,boolean,text) from public;
grant execute on function public.submit_entry(date,time,time,time,boolean,text),
  public.review_entry(uuid,text,text),
  public.revise_entry(uuid,date,time,time,time,boolean,text),
  public.admin_set_profile(uuid,text,boolean,boolean,boolean,text) to authenticated;
revoke all on schema private from public;
grant usage on schema private to authenticated;
grant execute on function private.is_active_user(), private.is_admin(),
  private.can_view_all(), private.can_approve_entries() to authenticated;
revoke all on function private.accept_invitation(), private.log_entry_event(),
  private.set_updated_at() from public;

-- A API publica expõe somente wrappers invoker; os corpos privilegiados ficam no schema não exposto.
alter function public.submit_entry(date,time,time,time,boolean,text) set schema private;
alter function public.revise_entry(uuid,date,time,time,time,boolean,text) set schema private;
alter function public.review_entry(uuid,text,text) set schema private;
alter function public.admin_set_profile(uuid,text,boolean,boolean,boolean,text) set schema private;

revoke execute on function private.submit_entry(date,time,time,time,boolean,text),
  private.revise_entry(uuid,date,time,time,time,boolean,text),
  private.review_entry(uuid,text,text),
  private.admin_set_profile(uuid,text,boolean,boolean,boolean,text) from public, anon;
grant execute on function private.submit_entry(date,time,time,time,boolean,text),
  private.revise_entry(uuid,date,time,time,time,boolean,text),
  private.review_entry(uuid,text,text),
  private.admin_set_profile(uuid,text,boolean,boolean,boolean,text) to authenticated;

create function public.submit_entry(p_work_date date, p_normal_entry time,
  p_point_exit time, p_final_exit time, p_final_exit_next_day boolean, p_note text)
returns void language sql security invoker set search_path = '' as $$
  select private.submit_entry(p_work_date,p_normal_entry,p_point_exit,p_final_exit,p_final_exit_next_day,p_note)
$$;
create function public.revise_entry(p_entry_id uuid, p_work_date date,
  p_normal_entry time, p_point_exit time, p_final_exit time,
  p_final_exit_next_day boolean, p_note text)
returns void language sql security invoker set search_path = '' as $$
  select private.revise_entry(p_entry_id,p_work_date,p_normal_entry,p_point_exit,p_final_exit,p_final_exit_next_day,p_note)
$$;
create function public.review_entry(p_entry_id uuid, p_decision text, p_reason text default null)
returns void language sql security invoker set search_path = '' as $$
  select private.review_entry(p_entry_id,p_decision,p_reason)
$$;
create function public.admin_set_profile(p_target uuid, p_role text, p_active boolean,
  p_can_approve boolean, p_can_export boolean, p_full_name text)
returns void language sql security invoker set search_path = '' as $$
  select private.admin_set_profile(p_target,p_role,p_active,p_can_approve,p_can_export,p_full_name)
$$;
revoke execute on function public.submit_entry(date,time,time,time,boolean,text),
  public.revise_entry(uuid,date,time,time,time,boolean,text),
  public.review_entry(uuid,text,text),
  public.admin_set_profile(uuid,text,boolean,boolean,boolean,text) from public, anon;
grant execute on function public.submit_entry(date,time,time,time,boolean,text),
  public.revise_entry(uuid,date,time,time,time,boolean,text),
  public.review_entry(uuid,text,text),
  public.admin_set_profile(uuid,text,boolean,boolean,boolean,text) to authenticated;
