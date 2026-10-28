// Teste visual isolado: nenhuma chave, pedido, conversão ou notificação real.
const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.QF_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{for(const width of [320,390,1366]){
  const page=await browser.newPage({viewport:{width,height:900}});await page.route('https://**/*',r=>r.abort());
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main id="app-content"><div class="view"></div></main>');
  await page.evaluate(()=>{window.Screens={};window.QFAdminCloud={client:{rpc:async n=>({data:n==='qf_admin_negociacoes'?[]:{gerado_em:'2026-10-28',pedidos:[{id:'pedido-teste',status:'aberto',titulo:'Teste de eletricista',cliente:'Cliente de teste',cidade:'Santo André'}],chaves:[{nome:'Profissional de teste',cidade:'Santo André',uf:'SP',especialidades:['cat_eletricista'],raio_km:10,chave_pix:'teste@example.com',status:'pendente'}],pagamentos:[],leads:[],pagamento_pos_servico:{observacao:'Repasse em homologação.'}},error:null})}};});
  await page.addScriptTag({path:'qf-admin-financeiro.js'});await page.evaluate(()=>Screens.afterRender('/admin/financeiro',document.querySelector('main')));
  await page.locator('[data-qff-search]').waitFor();assert.match(await page.locator('main').innerText(),/teste@example.com/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'sem overflow '+width);
  await page.locator('[data-qff-filter="concluidos"]').click();assert.match(await page.locator('main').innerText(),/Nenhum pedido neste filtro/);
  await page.locator('[data-qff-filter="todos"]').click();await page.locator('[data-qff-keys]').selectOption('ausentes');assert.equal(await page.getByText('teste@example.com',{exact:true}).count(),0);
  await page.locator('[data-qff-keys]').selectOption('todos');
  fs.mkdirSync('docs/evidencias-operacao',{recursive:true});await page.screenshot({path:'docs/evidencias-operacao/financeiro-'+width+'.png',fullPage:true});
  console.log('PASS '+width+'px: painel financeiro, chave, filtros, sem overflow; dados simulados');await page.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
