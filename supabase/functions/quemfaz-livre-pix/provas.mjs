// Somente consultas autenticadas à Efí podem fornecer estas provas.
const cents=v=>Math.round(Number(v||0)*100);
const returned=p=>(Array.isArray(p?.devolucoes)&&p.devolucoes.length>0);
export function gotIncoming(cob,b){
 if(cob?.txid!==b.txid||cents(cob?.valor?.original)!==Number(b.valor_centavos)||cob.status!=='CONCLUIDA')return null;
 const pays=Array.isArray(cob.pix)?cob.pix:[];
 if(!pays.length||pays.some(p=>returned(p)||!p.endToEndId||String(p.endToEndId).length<16||!Number.isFinite(Number(p.valor))||Number(p.valor)<=0))return null;
 const ids=pays.map(p=>String(p.endToEndId));
 if(new Set(ids).size!==ids.length||pays.reduce((n,p)=>n+cents(p.valor),0)!==Number(b.valor_centavos))return null;
 return ids.sort().join(',');
}
export function sentVerified(sent,b){
 return sent?.status==='REALIZADO'&&sent.idEnvio===b.id_envio&&
  cents(sent.valor)===Number(b.repasse_centavos)&&sent.favorecido?.chave===b.chave_pix&&
  typeof sent.endToEndId==='string'&&sent.endToEndId.length>=16&&!returned(sent);
}
