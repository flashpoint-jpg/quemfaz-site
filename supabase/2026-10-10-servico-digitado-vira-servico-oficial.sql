-- V11.65: o serviço que o cliente (ou o profissional) digita com as próprias palavras cai no serviço oficial.
-- Antes: "Pinturas" virava um serviço novo, sem nenhum profissional, e o pedido não era avisado a ninguém
-- (havia 76 pintores). Agora o banco reconhece o serviço pelo que foi escrito, em qualquer caminho de entrada.
create table if not exists private.qf_servico_palavras (
  raiz text not null,        -- começo de palavra (ou expressão), sem acento e em minúsculas
  categoria text not null,   -- serviço oficial
  peso int not null default 2,
  primary key (raiz, categoria)
);
revoke all on private.qf_servico_palavras from public, anon, authenticated;

insert into private.qf_servico_palavras (raiz, categoria, peso) values
  ('pint','cat_pintor',2),('textura','cat_pintor',2),('grafiato','cat_pintor',2),
  ('funil','cat_funileiro',3),('pintura automotiva','cat_funileiro',4),('pintor automotivo','cat_funileiro',4),('pintura de carro','cat_funileiro',4),('martelinho','cat_funileiro',3),
  ('eletric','cat_eletricista',2),('tomada','cat_eletricista',2),('disjuntor','cat_eletricista',2),('fiacao','cat_eletricista',2),('chuveiro','cat_eletricista',2),('curto circuito','cat_eletricista',3),('luminaria','cat_eletricista',2),('lustre','cat_eletricista',2),
  ('autoeletric','cat_autoeletrico',4),('auto eletric','cat_autoeletrico',4),('eletrica automotiva','cat_autoeletrico',4),('eletricista automotivo','cat_autoeletrico',4),('eletricista de carro','cat_autoeletrico',4),
  ('encan','cat_encanador',2),('hidraul','cat_encanador',2),('vazamento','cat_encanador',2),('torneira','cat_encanador',2),('bombeiro hidraulico','cat_encanador',3),('valvula de descarga','cat_encanador',3),('descarga do vaso','cat_encanador',3),('vaso sanitario','cat_encanador',2),('caixa acoplada','cat_encanador',3),('registro','cat_encanador',1),
  ('desentup','cat_desentupidor',3),('entupi','cat_desentupidor',3),('esgoto','cat_desentupidor',2),('fossa','cat_desentupidor',2),
  ('pedreir','cat_pedreiro',2),('alvenaria','cat_pedreiro',2),('reboco','cat_pedreiro',2),('construcao','cat_pedreiro',2),('reforma','cat_pedreiro',1),('empreit','cat_pedreiro',2),('muro','cat_pedreiro',2),('contrapiso','cat_pedreiro',2),
  ('azulej','cat_azulejista',3),('piso','cat_azulejista',2),('porcelanato','cat_azulejista',3),('ceramic','cat_azulejista',2),('revestimento','cat_azulejista',2),('rejunt','cat_azulejista',3),('laminado','cat_azulejista',3),('vinilico','cat_azulejista',3),
  ('gess','cat_gesseiro',3),('drywall','cat_gesseiro',3),('sanca','cat_gesseiro',3),('forro','cat_gesseiro',2),
  ('telhad','cat_telhadista',3),('telha','cat_telhadista',2),('goteira','cat_telhadista',3),
  ('calha','cat_calheiro',3),('calheir','cat_calheiro',3),('rufo','cat_calheiro',3),
  ('impermeabiliz','cat_impermeabilizacao',3),('infiltrac','cat_impermeabilizacao',3),('manta asfaltica','cat_impermeabilizacao',3),
  ('montador','cat_montador',2),('montagem de move','cat_montador',3),('montar move','cat_montador',3),('montagem','cat_montador',1),('guarda roupa','cat_montador',2),('desmontagem','cat_montador',2),
  ('marcen','cat_marceneiro',3),('moveis planejados','cat_marceneiro',3),('movel planejado','cat_marceneiro',3),('carpint','cat_marceneiro',2),
  ('marido de aluguel','cat_marido_aluguel',4),('reparos gerais','cat_marido_aluguel',3),('pequenos reparos','cat_marido_aluguel',3),('servicos gerais','cat_marido_aluguel',3),('faz tudo','cat_marido_aluguel',3),('manutencao predial','cat_marido_aluguel',3),('manutencao residencial','cat_marido_aluguel',3),('servicos residenciais','cat_marido_aluguel',2),
  ('diarista','cat_diarista',3),('faxin','cat_diarista',2),('limpeza','cat_diarista',1),('domestica','cat_diarista',2),
  ('pos obra','cat_faxina_pos_obra',4),
  ('estofad','cat_limpeza_estofados',4),('sofa','cat_limpeza_estofados',4),('tapete','cat_limpeza_estofados',3),('colchao','cat_limpeza_estofados',3),
  ('caixa d','cat_caixa_dagua',4),('caixa de agua','cat_caixa_dagua',4),
  ('piscin','cat_piscineiro',4),
  ('passadeira','cat_passadeira',3),('passar roupa','cat_passadeira',3),
  ('ar condicionado','cat_arcondicionado',4),('arcondicionado','cat_arcondicionado',4),('split','cat_arcondicionado',3),('climatiz','cat_arcondicionado',3),
  ('geladeira','cat_geladeira',4),('freezer','cat_geladeira',4),('refriger','cat_geladeira',2),
  ('maquina de lavar','cat_maquina_lavar',4),('lavadora','cat_maquina_lavar',4),('lava e seca','cat_maquina_lavar',4),('lava roupa','cat_maquina_lavar',4),
  ('fogao','cat_fogao_microondas',4),('microondas','cat_fogao_microondas',4),('micro ondas','cat_fogao_microondas',4),('cooktop','cat_fogao_microondas',4),('forno','cat_fogao_microondas',2),
  ('antena','cat_antenista',3),('antenista','cat_antenista',3),
  ('televis','cat_tv_som',3),('tv','cat_tv_som',2),('home theater','cat_tv_som',3),
  ('celular','cat_celular',3),('iphone','cat_celular',3),('smartphone','cat_celular',3),
  ('informatica','cat_informatica',3),('computador','cat_informatica',3),('notebook','cat_informatica',3),('formatac','cat_informatica',3),
  ('internet','cat_internet_redes',3),('wifi','cat_internet_redes',3),('wi fi','cat_internet_redes',3),('roteador','cat_internet_redes',3),('cabeamento','cat_internet_redes',3),
  ('camera','cat_cftv_alarmes',3),('cftv','cat_cftv_alarmes',4),('alarme','cat_cftv_alarmes',3),('cerca eletrica','cat_cftv_alarmes',5),('interfone','cat_cftv_alarmes',3),('portao eletronico','cat_cftv_alarmes',4),
  ('energia solar','cat_energia_solar',5),('solar','cat_energia_solar',3),('fotovolt','cat_energia_solar',4),
  ('automacao industrial','cat_automacao_industrial',5),('automacao residencial','cat_automacao_residencial',5),('casa inteligente','cat_automacao_residencial',4),('automacao','cat_automacao_residencial',2),
  ('chaveir','cat_chaveiro',3),('fechadura','cat_chaveiro',3),('chave','cat_chaveiro',2),
  ('serralh','cat_serralheiro',3),('portao','cat_serralheiro',2),('grade','cat_serralheiro',2),
  ('sold','cat_soldador',2),
  ('vidrac','cat_vidraceiro',3),('vidro','cat_vidraceiro',1),('box','cat_vidraceiro',2),('espelho','cat_vidraceiro',2),
  ('toldo','cat_toldos_cortinas',3),('cortina','cat_toldos_cortinas',3),('persiana','cat_toldos_cortinas',3),
  ('dedetiz','cat_dedetizador',3),('cupim','cat_dedetizador',3),('barata','cat_dedetizador',3),('praga','cat_dedetizador',3),('rato','cat_dedetizador',2),
  ('jardin','cat_jardinagem',3),('grama','cat_jardinagem',3),('jardim','cat_jardinagem',3),
  ('poda','cat_poda_paisagista',3),('paisag','cat_poda_paisagista',3),('arvore','cat_poda_paisagista',3),
  ('frete','cat_frete',3),('carreto','cat_frete',3),
  ('mudanca','cat_mudancas',4),
  ('entreg','cat_entregador',2),('motoboy','cat_entregador',3),
  ('motorista','cat_motorista',3),
  ('guincho','cat_guincho',4),('reboque','cat_guincho',3),
  ('mecanic','cat_mecanico',3),('oficina','cat_mecanico',2),
  ('borrach','cat_borracheiro',3),('pneu','cat_borracheiro',3),
  ('bateria','cat_bateria_auto',3),
  ('lava jato','cat_lava_jato',4),('lavagem de carro','cat_lava_jato',4),('estetica automotiva','cat_lava_jato',5),('polimento','cat_lava_jato',3),
  ('baba','cat_baba',3),
  ('cuidador','cat_cuidador_idosos',3),('idoso','cat_cuidador_idosos',3),
  ('cozinheir','cat_cozinheira',3),
  ('garcom','cat_garcom_buffet',3),('buffet','cat_garcom_buffet',3),
  ('dj','cat_dj_som',3),('som para evento','cat_dj_som',4),
  ('fotograf','cat_fotografo',3),
  ('costur','cat_costureira',3),
  ('cabeleireir','cat_cabeleireiro',3),('cabelo','cat_cabeleireiro',2),
  ('manicure','cat_manicure',3),('pedicure','cat_manicure',3),('unha','cat_manicure',3),
  ('maquiad','cat_maquiador',3),('maquiagem','cat_maquiador',3),
  ('personal','cat_personal',3),
  ('professor','cat_professor',3),('aula','cat_professor',2),('reforco escolar','cat_professor',4),
  ('adestr','cat_adestrador',3),
  ('banho e tosa','cat_banho_tosa',5),('tosa','cat_banho_tosa',4),
  ('pet sitter','cat_pet_sitter',5),('passeador','cat_pet_sitter',4),('dog walker','cat_pet_sitter',4)
on conflict (raiz, categoria) do update set peso = excluded.peso;

-- Texto sem acento, minúsculo, só letras e números, com um espaço em cada ponta.
create or replace function private.qf_servico_texto(p text)
returns text language sql immutable set search_path to '' as $$
  select ' ' || trim(regexp_replace(
    translate(lower(coalesce(p, '')),
      'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
    '[^a-z0-9]+', ' ', 'g')) || ' ';
$$;

-- Todos os serviços oficiais que o texto menciona, do mais certo para o menos.
create or replace function private.qf_servicos_do_texto(p text, p_peso_min int default 1)
returns text[] language sql stable security definer set search_path to '' as $$
  select coalesce(array_agg(m.categoria order by m.peso desc, m.tam desc), array[]::text[])
  from (
    select w.categoria, max(w.peso) as peso, max(length(w.raiz)) as tam
    from private.qf_servico_palavras w
    where position(' ' || w.raiz in private.qf_servico_texto(p)) > 0 and w.peso >= coalesce(p_peso_min, 1)
    group by w.categoria
  ) m;
$$;

-- O nome que a pessoa digitou está guardado no próprio código do serviço ("cat_custom_pinturas_xxxx").
create or replace function private.qf_servico_nome_digitado(p_categoria text)
returns text language sql stable security definer set search_path to '' as $$
  select trim(coalesce((select c.nome from public.qf_categorias_personalizadas c where c.id = p_categoria), '') || ' ' ||
    replace(regexp_replace(regexp_replace(coalesce(p_categoria, ''), '^cat_custom_', ''), '_[a-z0-9]+$', ''), '_', ' '));
$$;

-- Pedido: serviço digitado (ou "Outros") vira o serviço oficial reconhecido no nome/título e, por último, na descrição.
create or replace function private.qf_chamado_servico_oficial()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v text[];
begin
  if new.categoria is null or new.categoria like 'cat_custom_%' or new.categoria = 'cat_outros' then
    v := private.qf_servicos_do_texto(private.qf_servico_nome_digitado(new.categoria) || ' ' || coalesce(new.titulo, ''));
    if cardinality(v) = 0 then
      -- Serviço digitado que tem profissional próprio (ex.: Cartomante) fica como está.
      if new.categoria like 'cat_custom_%' and exists (select 1 from public.qf_profissionais p where new.categoria = any(p.especialidades)) then
        return new;
      end if;
      v := private.qf_servicos_do_texto(new.descricao);
    end if;
    if cardinality(v) > 0 then new.categoria := v[1]; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists qf_a_chamado_servico_oficial_before_write on public.qf_chamados;
create trigger qf_a_chamado_servico_oficial_before_write
  before insert or update of categoria on public.qf_chamados
  for each row execute function private.qf_chamado_servico_oficial();

-- Profissional: quem digitou o serviço com as próprias palavras também passa a ter o serviço oficial equivalente.
create or replace function private.qf_profissional_servicos_oficiais()
returns trigger language plpgsql security definer set search_path to '' as $$
declare e text; v text[]; r text[] := coalesce(new.especialidades, array[]::text[]);
begin
  foreach e in array coalesce(new.especialidades, array[]::text[]) loop
    if e like 'cat_custom_%' then
      -- Só as palavras que identificam bem o serviço (peso 2 ou mais), para não dar ao profissional um serviço que ele não faz.
      v := private.qf_servicos_do_texto(private.qf_servico_nome_digitado(e), 2);
      r := (select array_agg(distinct x) from unnest(r || v) x);
    end if;
  end loop;
  new.especialidades := r;
  return new;
end;
$$;
drop trigger if exists qf_profissional_servicos_oficiais_before_write on public.qf_profissionais;
create trigger qf_profissional_servicos_oficiais_before_write
  before insert or update of especialidades on public.qf_profissionais
  for each row execute function private.qf_profissional_servicos_oficiais();

-- Quem já estava cadastrado com serviço digitado ganha o serviço oficial equivalente (o gatilho acima faz a conta).
update public.qf_profissionais set especialidades = especialidades
 where exists (select 1 from unnest(especialidades) x where x like 'cat_custom_%');
