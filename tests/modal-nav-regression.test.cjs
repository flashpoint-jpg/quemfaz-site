const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');

test('todas as janelas compartilhadas ficam acima da navegacao premium',()=>{
  const nav = html.indexOf('z-index: 110 !important;');
  assert.ok(nav>0,'barra premium está no CSS');
  assert.match(html,/#sheet-overlay\s*\{\s*z-index:\s*600/);
  assert.match(html,/body:has\(#sheet-overlay:not\(\.is-hidden\)\) \.tabbar/);
  assert.match(html,/body:has\(#sheet-overlay:not\(\.is-hidden\)\) \.qf-home-nav/);
  assert.match(html,/visibility:\s*hidden\s*!important/);
  assert.match(html,/pointer-events:\s*none\s*!important/);
  assert.match(html,/#sheet-overlay:not\(\.is-hidden\)\s*\{\s*isolation:\s*isolate/);
  assert.match(html,/#sheet-overlay \.sheet\s*\{[\s\S]*?max-height:\s*calc\(100dvh/);
});

test('Entrar no QuemFaz e menus de confirmação usam a mesma janela corrigida',()=>{
  assert.match(html,/PU\.openSheet\('<div class="stack"><h3 class="sheet__title">Entrar no QuemFaz/);
  assert.match(html,/function openSheet\(innerHtml, opts\)/);
  assert.match(html,/overlay\.id = 'sheet-overlay'/);
  assert.match(html,/function confirmDialog\(opts\)/);
  assert.match(html,/\{ persistent: true, confirm: true \}/);
});

test('sobreposições independentes possuem camada maior que a navegação (110)',()=>{
  assert.match(html,/qf-call-overlay\s*\{[^}]*z-index:\s*250/);
  assert.match(html,/qf-aviso-overlay\s*\{[^}]*z-index:\s*200/);
  assert.match(html,/qf-media-zoom\s*\{[^}]*z-index:\s*400/);
  assert.match(html,/qf-calc-result\s*\{[^}]*z-index:\s*9990/);
});
