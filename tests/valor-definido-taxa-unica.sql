do $$
begin
  assert public.qf_taxa_indicacao_centavos('cat_x', 100000) = 6000, 'T1 padrão 6%';
  perform public.t_admin(true);
  assert (public.qf_admin_salvar_taxa_indicacao('padrao', 600, 2000, true)->>'ok')::boolean, 'T2 teto';
  assert public.qf_taxa_indicacao_centavos('cat_x', 100000) = 2000, 'T2 teto aplicado';
  assert (public.qf_admin_salvar_taxa_indicacao('cat_pintor', 600, null, true, 'fixa', 1500)->>'ok')::boolean, 'T3 fixa';
  assert public.qf_taxa_indicacao_centavos('cat_pintor', 100000) = 1500, 'T3 taxa única';
  assert public.qf_taxa_indicacao_centavos('cat_pintor', 800) = 800, 'T3 nunca maior que o serviço';
  assert not (public.qf_admin_salvar_taxa_indicacao('cat_a', 600, null, true, 'fixa', null)->>'ok')::boolean, 'T4 fixa exige valor';
  assert (public.qf_admin_salvar_taxa_indicacao('cat_a', 600, null, true, 'xx', 1)->>'reason') = 'modo_invalido', 'T4 modo inválido';
  assert (public.qf_admin_salvar_taxa_indicacao('cat_pintor', 600, null, true)->>'ok')::boolean, 'T5 voltar a %';
  assert public.qf_taxa_indicacao_centavos('cat_pintor', 100000) = 6000, 'T5 volta a % próprio da profissão';
  perform public.t_admin(false);
end $$;
select 'TAXA UNICA: TODOS OS TESTES PASSARAM' as resultado;
