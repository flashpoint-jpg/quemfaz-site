-- QuemFaz — segurança da view qf_chamados_desbloqueados (aplicado em 2026-09-26)
-- Antes a view rodava com as permissões do dono (SECURITY DEFINER) e ignorava o RLS das tabelas.
-- Agora respeita o RLS de quem consulta. As políticas de qf_chamados, qf_profiles e qf_desbloqueios
-- já liberam exatamente o que a view mostra (chamados desbloqueados pelo profissional e o cliente deles),
-- então o resultado para o app não muda (conferido antes/depois: mesmas linhas e mesmo conteúdo).
alter view public.qf_chamados_desbloqueados set (security_invoker = true);
revoke all on public.qf_chamados_desbloqueados from anon;
