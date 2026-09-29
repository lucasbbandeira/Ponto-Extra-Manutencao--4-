-- Exclusão administrativa de perfis sem apagar o histórico de horas.
-- Usuários que já têm lançamentos devem ser desativados para preservar o registro.
create or replace function private.admin_delete_profile(p_target uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare target_role text;
declare target_active boolean;
begin
  if not (select private.is_admin()) then raise exception 'Somente o administrador pode excluir usuarios'; end if;
  if p_target = (select auth.uid()) then raise exception 'Nao e possivel excluir seu proprio perfil'; end if;
  select role, active into target_role, target_active from public.profiles where id = p_target for update;
  if not found then raise exception 'Usuario nao encontrado'; end if;
  if target_role = 'admin' and target_active
    and (select count(*) from public.profiles where role = 'admin' and active) <= 1 then
    raise exception 'Deve existir pelo menos um administrador ativo';
  end if;
  if exists (select 1 from public.overtime_entries where worker_id = p_target) then
    raise exception 'Este usuario possui lancamentos; desative o acesso para preservar o historico';
  end if;
  delete from auth.users where id = p_target;
end $$;

alter function private.admin_delete_profile(uuid) set search_path = '';
revoke all on function private.admin_delete_profile(uuid) from public, anon;
grant execute on function private.admin_delete_profile(uuid) to authenticated;

create or replace function public.admin_delete_profile(p_target uuid)
returns void language sql security invoker set search_path = '' as $$
  select private.admin_delete_profile(p_target)
$$;
revoke execute on function public.admin_delete_profile(uuid) from public, anon;
grant execute on function public.admin_delete_profile(uuid) to authenticated;
