const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('index.html', 'utf8');

test('confirmação de cancelamento passa por cima da barra de navegação e mostra ambas escolhas', () => {
  assert.match(html, /#sheet-overlay\s*\{\s*z-index:\s*600/);
  assert.match(html, /#sheet-overlay\[data-confirm="true"\]\s*\{[\s\S]*?align-items:\s*center/);
  assert.match(html, /#sheet-overlay\[data-confirm="true"\] \.btn-row \.btn\s*\{[^}]*min-height:\s*48px/);
  assert.match(html, /overlay\.dataset\.confirm = opts\.confirm \? 'true' : 'false'/);
  assert.match(html, /\{ persistent: true, confirm: true \}/);
  assert.match(html, /cancelLabel: 'Manter pedido', okLabel: 'Sim, cancelar pedido'/);
});

test('Manter pedido não cancela; Sim cancelar devolve confirmação verdadeira', async () => {
  let seq = 0;
  const buttons = new Map();
  const overlay = {
    id: 'sheet-overlay',
    dataset: {},
    classList: {hidden: true, add(name){ if(name === 'is-hidden') this.hidden=true; }, remove(name){ if(name === 'is-hidden') this.hidden=false; }},
    addEventListener(){},
    querySelector(){return null;},
    set innerHTML(htmlText) {
      this._html = htmlText;
      for (const [,id] of htmlText.matchAll(/id="(confirm_[^"]+)"/g)) buttons.set(id,{onclick:null});
    },
    get innerHTML(){return this._html}
  };
  const doc = {
    getElementById(id){return id==='sheet-overlay'? overlay:buttons.get(id)||null;},
    createElement(){throw new Error('overlay should already exist');},
    body:{appendChild(){}}
  };
  const first=html.indexOf('  function openSheet(');
  const end=html.indexOf('  global.PU = {',first);
  assert.ok(first>0&&end>first);
  const ctx={ document:doc, uid:()=>String(++seq),escapeHtml:s=>String(s)};
  vm.createContext(ctx);
  vm.runInContext(html.slice(first,end),ctx);
  const cancel=ctx.confirmDialog({title:'Cancelar pedido',message:'Tem certeza?',cancelLabel:'Manter pedido',okLabel:'Sim, cancelar pedido',danger:true});
  assert.equal(overlay.dataset.confirm,'true');
  assert.match(overlay.innerHTML,/Manter pedido/);
  assert.match(overlay.innerHTML,/Sim, cancelar pedido/);
  buttons.get('confirm_1_cancel').onclick();
  assert.equal(await cancel,false);
  assert.equal(overlay.classList.hidden,true);
  const confirm=ctx.confirmDialog({title:'Cancelar pedido',cancelLabel:'Manter pedido',okLabel:'Sim, cancelar pedido',danger:true});
  buttons.get('confirm_2_ok').onclick();
  assert.equal(await confirm,true);
  assert.equal(overlay.classList.hidden,true);
});

test('cancelamento só chama banco quando confirmação é verdadeira', () => {
  const i=html.indexOf("if (act === 'cancelar-pedido')");
  const j=html.indexOf("if (act === 'aprovar-orcamento')",i);
  const flow=html.slice(i,j);
  assert.match(flow,/if \(!ok\) return/);
  assert.match(flow,/cancelClientCall\(req\.id\)/);
  assert.match(flow,/Não foi possível cancelar/);
});
