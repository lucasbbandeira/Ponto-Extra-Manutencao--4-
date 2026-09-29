-- Execute DEPOIS que o primeiro administrador criar a conta e confirmar o proprio e-mail.
-- Troque apenas os dois valores entre aspas abaixo.
do $$
declare
  admin_email text := lower('SEU_EMAIL@EMPRESA.COM');
  admin_name text := 'Seu nome';
  admin_id uuid;
begin
  if exists (select 1 from public.profiles where role = 'admin') then
    raise exception 'Ja existe administrador. Use a tela Equipe e acessos.';
  end if;
  select id into admin_id from auth.users
    where lower(email) = admin_email and email_confirmed_at is not null;
  if admin_id is null then
    raise exception 'Conta nao encontrada ou e-mail ainda nao confirmado: %', admin_email;
  end if;
  insert into public.profiles(id, email, full_name, role, can_approve, can_export)
    values (admin_id, admin_email, admin_name, 'admin', true, true);
end $$;
