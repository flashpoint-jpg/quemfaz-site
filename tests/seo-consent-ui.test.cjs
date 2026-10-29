const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const widget=fs.readFileSync(path.join(__dirname,'../scripts/qf-seo-consent-widget.js'),'utf8');
const build=fs.readFileSync(path.join(__dirname,'../scripts/build-client.cjs'),'utf8');
test('divulgação retirada não monta controles nem concede consentimento',()=>{const {JSDOM}=require('jsdom');const d=new JSDOM('<form id="cadastro-prof-form"></form><section data-qf-seo-profile></section>',{runScripts:'outside-only'});d.window.eval(widget);d.window.QFSeoConsent.scan();assert.equal(d.window.document.querySelectorAll('[data-qf-seo-profile],[data-qf-seo-signup]').length,0);d.window.close();assert.match(build,/qf-seo-consent-widget\.js/);});
test('opt-in não bloqueia cadastro',()=>{assert.match(widget,/checkbox\.checked=false/);assert.match(widget,/não interfere no cadastro/);assert.doesNotMatch(widget,/preventDefault\(/);});
test('revogação limpa timestamp e dados não são publicados pelo widget',()=>{assert.match(widget,/autorizado_em:enabled\?now:null/);assert.match(widget,/auth\.getUser\(\)/);assert.doesNotMatch(widget,/service_role|SUPABASE_SERVICE_ROLE_KEY/);});
test('sem tabela o controle fica desabilitado',()=>{assert.match(widget,/if\(read\.error\)/);assert.match(widget,/fields\.checkbox\.disabled=true/);});
