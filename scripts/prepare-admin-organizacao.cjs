// Apply the administrative integration during the existing publication build.
// Keep the large legacy HTML source intact and fail if its integration points move.
module.exports=function prepareAdmin(source){
 const original='<script src="qf-admin-negociacoes.js?v=20261027-cards3"></script>';
 const replacement='<script src="qf-admin-organizacao.js?v=20261029-listas-balanco"></script>\n<script src="qf-admin-negociacoes.js?v=20261029-editar-excluir"></script>';
 if(!source.includes(original))throw Error('Integração de negociações não encontrada');
 source=source.replace(original,replacement);
 const cadastro='qf-admin-cadastro-pago.js?v=20261028-saldo-movimentacoes';
 if(!source.includes(cadastro))throw Error('Integração de cadastros não encontrada');
 source=source.replace(cadastro,'qf-admin-cadastro-pago.js?v=20261029-excluir-lista');
 const start=source.indexOf('  function admMovHtml(d) {');
 const end=source.indexOf('  async function admMovCarregar',start);
 if(start<0||end<0)throw Error('Integração de movimentações não encontrada');
 const block=source.slice(start,end);
 const before="+ '</td>' + valor + '</tr>';";
 const after="+ '<br><a class=\"btn btn--outline btn--sm\" href=\"#' + PU.escapeHtml(m.rota || '/admin/negociacoes') + '\">Ver / editar</a></td>' + valor + '</tr>';";
 if(!block.includes(before))throw Error('Ações de movimentações não encontradas');
 return source.slice(0,start)+block.replace(before,after)+source.slice(end);
};

