-- Funil de clientes: guarda meio, termo de busca e tipo de clique de cada evento,
-- para conciliar os cliques do Google Ads com as visitas por campanha e palavra-chave.
-- Nao guarda o identificador do clique (gclid) nem dado pessoal.
alter table public.qf_client_funnel
  add column if not exists medium text,
  add column if not exists term text,
  add column if not exists click_type text;

alter table public.qf_client_funnel drop constraint if exists qf_client_funnel_click_type_check;
alter table public.qf_client_funnel add constraint qf_client_funnel_click_type_check
  check (click_type is null or click_type in ('gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'ttclid'));

-- As colunas do funil tem INSERT liberado por coluna; sem isto o evento inteiro seria recusado.
grant insert (medium, term, click_type) on public.qf_client_funnel to anon, authenticated;
