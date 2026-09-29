-- Fluxo de solicitacao: a pessoa cria a conta e o administrador aprova depois.
alter table public.profiles
  add column if not exists approval_status text not null default 'approved';

alter table public.profiles drop constraint if exists profiles_approval_status_check;
alter table public.profiles add constraint profiles_approval_status_check
  check (approval_status in ('pending', 'approved', 'rejected'));

update public.profiles set approval_status = case when active then 'approved' else 'rejected' end
where approval_status is null;

create or replace function private.accept_invitation() returns trigger language plpgsql security definer
set search_path = '' as $$
declare invite public.invitations%rowtype;
declare requested_name text;
begin
  select * into invite from public.invitations
  where email = lower(new.email) and status = 'pending' for update;
  requested_name := nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '');
  if requested_name is null then requested_name := split_part(new.email, '@', 1); end if;
  if found then
    insert into public.profiles(id, email, full_name, role, active, approval_status, can_approve, can_export)
    values (new.id, lower(new.email), invite.full_name, invite.role, true, 'approved',
      invite.role in ('admin', 'supervisor'), invite.role in ('admin', 'supervisor'));
    update public.invitations set status = 'claimed', claimed_at = now(), claimed_by = new.id
    where id = invite.id;
  else
    insert into public.profiles(id, email, full_name, role, active, approval_status, can_approve, can_export)
    values (new.id, lower(new.email), requested_name, 'maintainer', false, 'pending', false, false);
  end if;
  return new;
end $$;

create or replace function private.admin_set_profile(p_target uuid, p_role text, p_active boolean,
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
    approval_status = case when p_active then 'approved' else 'rejected' end,
    can_approve = case when p_role = 'admin' then true when p_role = 'supervisor' then p_can_approve else false end,
    can_export = case when p_role = 'admin' then true when p_role = 'supervisor' then p_can_export else false end,
    full_name = trim(p_full_name) where id = p_target;
end $$;

create or replace function private.admin_review_profile(p_target uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare target_role text;
begin
  if not (select private.is_admin()) then raise exception 'Somente o administrador pode revisar cadastros'; end if;
  if p_target = (select auth.uid()) then raise exception 'Nao e possivel revisar seu proprio cadastro'; end if;
  select role into target_role from public.profiles where id = p_target for update;
  if not found then raise exception 'Cadastro nao encontrado'; end if;
  update public.profiles set active = p_approve,
    approval_status = case when p_approve then 'approved' else 'rejected' end,
    updated_at = now()
  where id = p_target;
end $$;

alter function private.admin_set_profile(uuid,text,boolean,boolean,boolean,text)
  set search_path = '';
revoke all on function private.admin_review_profile(uuid,boolean) from public, anon;
grant execute on function private.admin_review_profile(uuid,boolean) to authenticated;

create or replace function public.admin_review_profile(p_target uuid, p_approve boolean)
returns void language sql security invoker set search_path = '' as $$
  select private.admin_review_profile(p_target, p_approve)
$$;
revoke execute on function public.admin_review_profile(uuid,boolean) from public, anon;
grant execute on function public.admin_review_profile(uuid,boolean) to authenticated;
