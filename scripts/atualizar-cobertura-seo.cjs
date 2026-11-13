// Atualiza data/seo-coverage-205.json com as cidades e especialidades dos profissionais cadastrados.
// Lê a função pública qf_seo_cobertura() (só cidade, UF e especialidades; nenhum dado pessoal).
const fs=require('node:fs');
const path=require('node:path');
const file=path.join(__dirname,'..','data','seo-coverage-205.json');
const URL_BASE=process.env.SUPABASE_URL||'https://dczlyrgnzlxmzghzaooz.supabase.co';
const KEY=process.env.SUPABASE_KEY||'sb_publishable_-WiYw_1QTzW0l9o0d4ZU9Q_kSadNA2A';
async function load(){
 if(process.env.QF_COBERTURA_TESTE)return JSON.parse(fs.readFileSync(process.env.QF_COBERTURA_TESTE,'utf8'));
 const r=await fetch(URL_BASE+'/rest/v1/rpc/qf_seo_cobertura',{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json'},body:'{}'});
 if(!r.ok)throw new Error('Supabase respondeu '+r.status);
 return r.json();
}
(async()=>{
 const rows=await load();
 if(!Array.isArray(rows))throw new Error('Resposta inesperada');
 const cidades=rows.filter(x=>x.cidade&&x.uf&&Array.isArray(x.especialidades)&&x.especialidades.length)
  .map(x=>({cidade:String(x.cidade).trim(),uf:String(x.uf).trim(),especialidades:[...new Set(x.especialidades)].sort()}))
  .sort((a,b)=>a.uf.localeCompare(b.uf)||a.cidade.localeCompare(b.cidade,'pt-BR'));
 const atual=JSON.parse(fs.readFileSync(file,'utf8'));
 // Trava de segurança: não publica se a leitura vier incompleta.
 if(cidades.length<Math.floor(atual.cidades.length*0.8))throw new Error('Leitura suspeita: '+cidades.length+' cidades contra '+atual.cidades.length+' atuais. Nada foi alterado.');
 const norm=l=>JSON.stringify([...l].sort((a,b)=>(a.uf+a.cidade).localeCompare(b.uf+b.cidade)));
 if(norm(cidades)===norm(atual.cidades)){console.log('Sem mudanças ('+cidades.length+' cidades).');return;}
 const hoje=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
 fs.writeFileSync(file,JSON.stringify({consultadoEm:hoje,origem:atual.origem,cidades},null,2)+'\n');
 console.log('Atualizado: '+cidades.length+' cidades.');
})().catch(e=>{console.error(e.message);process.exit(1);});
