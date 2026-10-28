-- Apenas registro da chave Pix. Não executa pagamentos nem repasses.
create table if not exists public.qf_livre_pix_chaves (
 profissional_id uuid primary key references public.qf_profissionais(user_id),
 chave_pix text not null check(length(chave_pix) between 5 and 100),
 status text not null default 'pendente' check(status='pendente'),
 atualizado_em timestamptz not null default now()
);
alter table public.qf_livre_pix_chaves enable row level security;
revoke all on table public.qf_livre_pix_chaves from public,anon;
grant select,insert,update on public.qf_livre_pix_chaves to authenticated;
create policy qf_livre_pix_chaves_ler_propria on public.qf_livre_pix_chaves
 for select to authenticated using(profissional_id=(select auth.uid()));
create policy qf_livre_pix_chaves_inserir_propria on public.qf_livre_pix_chaves
 for insert to authenticated with check(
 profissional_id=(select auth.uid()) and status='pendente');
create policy qf_livre_pix_chaves_atualizar_propria on public.qf_livre_pix_chaves
 for update to authenticated using(profissional_id=(select auth.uid()))
 with check(profissional_id=(select auth.uid()) and status='pendente');
