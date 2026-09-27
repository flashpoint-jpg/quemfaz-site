-- V11.11.8: admin tira chamados das listas do painel (Últimos chamados / Sem resposta).
-- O chamado do cliente NÃO é apagado; só qf_chamado_cascata.oculto_admin = true. Já aplicado em dczlyrgnzlxmzghzaooz.
alter table public.qf_chamado_cascata add column if not exists oculto_admin boolean not null default false;
-- função public.qf_admin_ocultar_chamados(uuid[]) (null = todos) e filtros "not k.oculto_admin"
-- em qf_admin_cascata_resumo (recentes) e qf_admin_chamados_sem_resposta.
