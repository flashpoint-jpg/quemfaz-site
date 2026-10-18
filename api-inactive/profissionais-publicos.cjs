// Public professional API - fail closed until an isolated database has passed RLS tests.
// No service_role, credentials, private profiles, payments or order data are used.
// This module is intentionally not wired into the production build or routing.
'use strict';
const ENABLED = process.env.QF_PUBLIC_PROFESSIONALS_VERIFIED === 'true';
const allowed = ['profissional_id','nome_profissional','servicos','cidade_atendida','uf'];
function validate(input={}) {
  const categoria=String(input.categoria||'').trim();
  const cidade=String(input.cidade||'').trim();
  const uf=String(input.uf||'').trim().toUpperCase();
  if(!categoria || !cidade || !/^[A-Z]{2}$/.test(uf))throw new Error('Categoria, cidade e UF são obrigatórias');
  if(categoria.length>120||cidade.length>120)throw new Error('Filtro muito longo');
  return {categoria,cidade,uf};
}
function project(rows,filters){
  const f=validate(filters);
  return rows.filter(r=>r.autorizado===true&&r.autorizado_em&&r.revogado!==true
    &&r.ativo===true&&Array.isArray(r.servicos)&&r.servicos.some(s=>s.toLocaleLowerCase('pt-BR')===f.categoria.toLocaleLowerCase('pt-BR'))
    &&r.cidade_atendida?.toLocaleLowerCase('pt-BR')===f.cidade.toLocaleLowerCase('pt-BR')&&r.uf===f.uf
    &&r.atendimento_verificado===true)
    .map(r=>Object.fromEntries(allowed.map(k=>[k,r[k]])));
}
async function list(client,filters){
  if(!ENABLED) return {status:503,body:{error:'Consulta pública ainda não habilitada'}};
  const f=validate(filters);
  // Expects an approved, security-reviewed, column-limited public view. Never query raw private tables.
  const {data,error}=await client.from('qf_seo_profissionais_publicos').select(allowed.join(','))
    .eq('cidade_atendida',f.cidade).eq('uf',f.uf).contains('servicos',[f.categoria]).limit(50);
  if(error)return {status:503,body:{error:'Consulta indisponível'}};
  return {status:200,body:{profissionais:(data||[]).map(r=>Object.fromEntries(allowed.map(k=>[k,r[k]])))}};
}
module.exports={validate,project,list,allowed};
