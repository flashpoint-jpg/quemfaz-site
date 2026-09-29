-- QuemFaz — editor de artes dos anúncios.
-- Salva os elementos separados (foto/logo/textos) em arte_config para permitir
-- editar e baixar novamente sem depender de Canva/Photoshop.

alter table public.qf_anuncios
  add column if not exists arte_config jsonb not null default '{}'::jsonb;

create or replace function public.qf_editar_anuncio_proprio(
  p_anuncio_id uuid,
  p_empresa text,
  p_chamada text,
  p_imagem_data text,
  p_whatsapp text,
  p_link text default null,
  p_arte_config jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.qf_anuncios;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  select * into v_row
  from public.qf_anuncios
  where id = p_anuncio_id and anunciante_id = v_uid;

  if v_row.id is null then
    raise exception 'ad not found';
  end if;

  p_empresa := trim(coalesce(p_empresa,''));
  p_chamada := trim(coalesce(p_chamada,''));
  p_whatsapp := trim(coalesce(p_whatsapp,''));
  p_link := nullif(trim(coalesce(p_link,'')), '');

  if length(p_empresa) < 2 or length(p_empresa) > 60 then raise exception 'invalid company name'; end if;
  if length(p_chamada) < 4 or length(p_chamada) > 90 then raise exception 'invalid ad headline'; end if;
  if p_whatsapp = '' then raise exception 'whatsapp required'; end if;
  if p_imagem_data is null or length(p_imagem_data) < 100 then raise exception 'image required'; end if;
  if length(p_imagem_data) > 1800000 then raise exception 'image too large'; end if;

  update public.qf_anuncios
  set anunciante_nome = p_empresa,
      contato = p_whatsapp,
      whatsapp = p_whatsapp,
      titulo = p_chamada,
      texto = p_chamada,
      imagem_data = p_imagem_data,
      destino_url = p_link,
      arte_config = coalesce(p_arte_config, '{}'::jsonb),
      atualizado_em = now()
  where id = p_anuncio_id;

  return jsonb_build_object('ok', true, 'anuncio_id', p_anuncio_id);
end;
$$;

revoke execute on function public.qf_editar_anuncio_proprio(uuid,text,text,text,text,text,jsonb) from public;
revoke execute on function public.qf_editar_anuncio_proprio(uuid,text,text,text,text,text,jsonb) from anon;
grant execute on function public.qf_editar_anuncio_proprio(uuid,text,text,text,text,text,jsonb) to authenticated;
