-- NOVOS PLANOS: PREPARACAO INERTE (nao habilitar vendas/visitas sem aval e testes).
-- A publicacao desta migration por si so NAO altera fluxos existentes:
-- - nao desliga a cobranca anterior, nao troca catalogo publico;
-- - nao altera/cancela planos pagos, recargas, bonus de indicacao ou pagamentos;
-- - nao inicia transferencias Pix ou devolucoes.
-- Valores e cotas abaixo sao PROPOSTOS, pendentes de confirmacao expressa.
-- Historico existente permanece intacto.

create table if not exists private.qf_planos_v2_config (
 id boolean primary key default true check (id),
 vendas_habilitadas boolean not null default false check (vendas_habilitadas=false),
 comissao_desativada_verificada boolean not null default false,
 limites_confirmados boolean not null default false,
 precos_confirmados boolean not null default false,
 operacao_pix_validada boolean not null default false,
 atualizado_em timestamptz not null default now()
);
insert into private.qf_planos_v2_config(id) values (true) on conflict (id) do nothing;

create table if not exists private.qf_planos_v2_catalogo (
 codigo text primary key check(codigo in ('avulso','basico','pro','completo')),
 nome text not null,
 preco_centavos integer not null check(preco_centavos>=1300),
 cota integer check(cota between 1 and 100),
 periodo_dias integer not null default 30 check(periodo_dias=30),
 status text not null default 'proposta' check(status in ('proposta','confirmado')),
 checkout_habilitado boolean not null default false check(checkout_habilitado=false),
 criado_em timestamptz not null default now(),
 atualizado_em timestamptz not null default now(),
 constraint qf_v2_cota_tipo check((codigo='avulso' and cota is null) or (codigo<>'avulso' and cota is not null))
);
insert into private.qf_planos_v2_catalogo(codigo,nome,preco_centavos,cota)
values ('avulso','Avulso',1300,null),
       ('basico','Básico',3990,10),
       ('pro','Pro',7990,25),
       ('completo','Mensal completo',14990,100)
on conflict(codigo) do nothing;

-- Contrato registra os termos exatos e o pagamento que o financia.
-- Cliente/navegador NAO tem acesso de escrita. Ativacao exige verificacao bancaria no servidor.
create table if not exists private.qf_planos_v2_assinaturas (
 id uuid primary key default gen_random_uuid(),
 profissional_id uuid not null references public.qf_profiles(id),
 codigo text not null references private.qf_planos_v2_catalogo(codigo) check(codigo<>'avulso'),
 recarga_id uuid unique references public.qf_recargas(id),
 preco_contratado_centavos integer not null check(preco_contratado_centavos>=1300),
 cota_contratada integer not null check(cota_contratada between 1 and 100),
 status text not null default 'aguardando' check(status in ('aguardando','pago','estornado','cancelado')),
 pagamento_confirmado_em timestamptz,
 inicio_em timestamptz,
 fim_em timestamptz,
 criado_em timestamptz not null default now(),
 constraint qf_v2_assinaturas_pago_valido check (
  status<>'pago' or
  (recarga_id is not null and pagamento_confirmado_em is not null and
   inicio_em is not null and fim_em is not null and fim_em>inicio_em)
 ),
 constraint qf_v2_assinaturas_periodo check (
  inicio_em is null or fim_em is null or fim_em<=inicio_em+interval '30 days'
 )
);
create index if not exists qf_planos_v2_assinaturas_profissional
 on private.qf_planos_v2_assinaturas(profissional_id,fim_em desc);

-- Contador nao mutavel pelo aplicativo: cada desbloqueio deve ser contabilizado uma so vez.
-- Integracao deve inserir o desbloqueio e seu consumo NA MESMA transacao Postgres.
create table if not exists private.qf_planos_v2_consumos (
 id uuid primary key default gen_random_uuid(),
 assinatura_id uuid not null references private.qf_planos_v2_assinaturas(id),
 desbloqueio_id uuid not null unique references public.qf_desbloqueios(id),
 criado_em timestamptz not null default now()
);
create index if not exists qf_planos_v2_consumos_assinatura
 on private.qf_planos_v2_consumos(assinatura_id);

create table if not exists private.qf_visitas_v2_config (
 id boolean primary key default true check(id),
 habilitado boolean not null default false check(habilitado=false),
 valor_proposto_centavos integer not null default 2500 check(valor_proposto_centavos>0),
 valor_confirmado boolean not null default false,
 tarifa_efi_responsavel text check(tarifa_efi_responsavel in ('quemfaz','profissional')),
 repasse_automatico_verificado boolean not null default false,
 reembolso_testado boolean not null default false,
 atualizado_em timestamptz not null default now()
);
insert into private.qf_visitas_v2_config(id) values (true) on conflict(id) do nothing;

-- Apenas estrutura de conciliacao. Nao existem rotas para gerar ou transferir Pix.
create table if not exists private.qf_visitas_v2 (
 id uuid primary key default gen_random_uuid(),
 chamado_id uuid not null unique references public.qf_chamados(id),
 cliente_id uuid not null references public.qf_profiles(id),
 profissional_id uuid references public.qf_profiles(id),
 valor_centavos integer not null check(valor_centavos>0),
 status text not null default 'rascunho' check(status in (
  'rascunho','aguardando_pagamento','pix_pronto','pago','visita_confirmada',
  'repasse_pendente','repassado','contestada','devolvido')),
 txid text unique,
 end_to_end_id text unique,
 pago_em timestamptz,
 visita_confirmada_em timestamptz,
 repassado_em timestamptz,
 devolvido_em timestamptz,
 criado_em timestamptz not null default now(),
 atualizado_em timestamptz not null default now(),
 constraint qf_visita_paga_verificada check (
   status not in ('pago','visita_confirmada','repasse_pendente','repassado','contestada','devolvido')
   or (pago_em is not null and end_to_end_id is not null)),
 constraint qf_visita_repasse_guard check(status<>'repassado' or repassado_em is not null),
 constraint qf_visita_devolucao_guard check(status<>'devolvido' or devolvido_em is not null)
);

alter table private.qf_planos_v2_config enable row level security;
alter table private.qf_planos_v2_catalogo enable row level security;
alter table private.qf_planos_v2_assinaturas enable row level security;
alter table private.qf_planos_v2_consumos enable row level security;
alter table private.qf_visitas_v2_config enable row level security;
alter table private.qf_visitas_v2 enable row level security;

revoke all on private.qf_planos_v2_config,
 private.qf_planos_v2_catalogo,
 private.qf_planos_v2_assinaturas,
 private.qf_planos_v2_consumos,
 private.qf_visitas_v2_config,
 private.qf_visitas_v2 from public, anon, authenticated;
