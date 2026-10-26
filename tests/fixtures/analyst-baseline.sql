-- Execute somente este arquivo no SQL Editor do Supabase já utilizado pelo projeto.
-- Não apaga usuários, lançamentos ou histórico. Pode ser executado novamente.
begin;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin','supervisor','maintainer','analyst'));
alter table public.invitations drop constraint if exists invitations_role_check;
alter table public.invitations add constraint invitations_role_check
  check (role in ('admin','supervisor','maintainer','analyst'));
alter table public.profiles drop constraint if exists permissions_for_management;
alter table public.profiles add constraint permissions_for_management check (
  (role <> 'maintainer' or (not can_approve and not can_export))
  and (role <> 'analyst' or (not can_approve and can_export))
);

-- Reutiliza as políticas SELECT existentes. Não concede escrita ao analista.
create or replace function private.can_view_all() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = (select auth.uid())
    and active and approval_status = 'approved' and role in ('admin','supervisor','analyst'))
$$;

create or replace function private.can_approve_entries() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = (select auth.uid())
    and active and approval_status = 'approved'
    and (role = 'admin' or (role = 'supervisor' and can_approve)))
$$;

create or replace function private.admin_set_profile(p_target uuid, p_role text, p_active boolean,
  p_can_approve boolean, p_can_export boolean, p_full_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare old_role text;
begin
  if not (select private.is_admin()) then raise exception 'Somente o administrador pode alterar usuarios'; end if;
  if p_role is null or p_role not in ('admin','supervisor','maintainer','analyst') then raise exception 'Perfil invalido'; end if;
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
    approval_status = case when p_active then 'approved' else 'rejected' end,
    can_approve = case when p_role = 'admin' then true when p_role = 'supervisor' then p_can_approve else false end,
    can_export = case when p_role in ('admin','analyst') then true when p_role = 'supervisor' then p_can_export else false end,
    full_name = trim(p_full_name) where id = p_target;
end $$;

create or replace function private.accept_invitation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare invite public.invitations%rowtype;
declare requested_name text;
declare has_invitation boolean;
begin
  select * into invite from public.invitations
    where email = lower(new.email) and status = 'pending' for update;
  has_invitation := found;
  requested_name := nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name','')), '');
  if requested_name is null then requested_name := split_part(new.email, '@', 1); end if;
  if has_invitation then
    insert into public.profiles(id,email,full_name,role,active,approval_status,can_approve,can_export)
    values(new.id,lower(new.email),invite.full_name,invite.role,true,'approved',
      invite.role in ('admin','supervisor'), invite.role in ('admin','supervisor','analyst'));
    update public.invitations set status = 'claimed', claimed_at = now(), claimed_by = new.id where id = invite.id;
  else
    insert into public.profiles(id,email,full_name,role,active,approval_status,can_approve,can_export)
    values(new.id,lower(new.email),requested_name,'maintainer',false,'pending',false,false);
  end if;
  return new;
end $$;

-- Bloqueia também RPCs antigas de correção: um manutentor convertido em analista
-- não pode editar os próprios lançamentos antigos usando chamadas diretas à API.
create or replace function private.guard_analyst_entry_write() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if exists(select 1 from public.profiles where id = (select auth.uid()) and role = 'analyst') then
    raise exception 'Analista possui acesso somente para consulta e download de relatorios' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists overtime_analyst_readonly on public.overtime_entries;
create trigger overtime_analyst_readonly before insert or update or delete on public.overtime_entries
  for each row execute function private.guard_analyst_entry_write();

revoke all on function private.can_view_all(), private.can_approve_entries(),
  private.admin_set_profile(uuid,text,boolean,boolean,boolean,text) from public, anon;
grant execute on function private.can_view_all(), private.can_approve_entries(),
  private.admin_set_profile(uuid,text,boolean,boolean,boolean,text) to authenticated;
revoke all on function private.accept_invitation(), private.guard_analyst_entry_write() from public, anon;
notify pgrst, 'reload schema';
commit;

-- Conferência: deve aparecer analyst nas duas listas de perfis permitidos.
select conname, pg_get_constraintdef(oid) as regra
from pg_constraint where conrelid in ('public.profiles'::regclass,'public.invitations'::regclass)
and conname in ('profiles_role_check','invitations_role_check','permissions_for_management');
