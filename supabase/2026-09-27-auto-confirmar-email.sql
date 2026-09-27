-- V11.11.6: cadastro não exige mais clicar no link do e-mail. Já aplicado em dczlyrgnzlxmzghzaooz.
update auth.users set email_confirmed_at = now() where email_confirmed_at is null;
create or replace function qf_private.auto_confirmar_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is null then new.email_confirmed_at := now(); end if;
  return new;
end $$;
drop trigger if exists qf_auto_confirmar_email on auth.users;
create trigger qf_auto_confirmar_email before insert on auth.users
  for each row execute function qf_private.auto_confirmar_email();
