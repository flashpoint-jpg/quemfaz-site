const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(require.resolve('../qf-client-acquisition.js'), 'utf8');
function setup(route) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="app-shell" data-route="${route}"><div class="qf-landing">
      <header class="qf-landing-topbar">Topo cliente e acesso profissional</header>
      <section class="qf-home-livre" data-qf-home-livre><a href="#/como-funciona">Conhecer o plano</a></section>
      <section class="qf-landing-hero"><div class="qf-hero2">
        <div class="qf-hero2-head"><h1>Precisando de um profissional?</h1></div>
        <div class="qf-brandrot" data-brandrot><a href="#/anuncie">Anuncie</a></div>
        <div class="qf-landing-actions"><form data-landing-service-form><input data-landing-service-search><button type="submit">Pedir grátis</button></form></div>
      </div></section>
      <div class="qf-landing-body">Como funciona e serviços</div>
      <footer>Institucional</footer>
    </div></div></body></html>`, { url: 'https://quemfazservico.com.br/?demo=1' });
  const w = dom.window;
  Object.defineProperty(w, 'crypto', { configurable: true, value: webcrypto });
  vm.runInNewContext(source, {
    window: w, document: w.document, location: w.location,
    localStorage: w.localStorage, sessionStorage: w.sessionStorage,
    URLSearchParams, Node: w.Node, MutationObserver: w.MutationObserver,
    console, Date, Promise
  }, { filename: 'qf-client-acquisition.js' });
  w.dispatchEvent(new w.Event('DOMContentLoaded'));
  return dom;
}
test('home de cliente coloca pedido antes de anúncios e card profissional', () => {
  const dom = setup('inicio');
  const d = dom.window.document;
  const landing = d.querySelector('.qf-landing');
  const children = Array.from(landing.children);
  const hero = d.querySelector('.qf-landing-hero');
  const body = d.querySelector('.qf-landing-body');
  const plan = d.querySelector('[data-qf-home-livre]');
  assert.ok(children.indexOf(hero) < children.indexOf(body));
  assert.ok(children.indexOf(body) < children.indexOf(plan), 'Plano Livre abaixo do conteúdo voltado ao cliente');
  const copy = d.querySelector('.qf-hero2');
  const items = Array.from(copy.children);
  assert.ok(items.indexOf(d.querySelector('.qf-landing-actions')) < items.indexOf(d.querySelector('[data-brandrot]')));
  assert.match(d.querySelector('[data-qf-client-first-tip]').textContent, /pedido grátis/);
  assert.ok(d.querySelector('[data-landing-service-form]'), 'formulário original permanece');
  assert.equal(plan.querySelector('a').getAttribute('href'), '#/como-funciona');
  dom.window.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  assert.equal(d.querySelectorAll('[data-qf-client-first-tip]').length, 1, 'sem duplicar aviso');
  dom.window.close();
});
test('rotas diferentes da home não são reorganizadas', () => {
  const dom = setup('profissional');
  const d = dom.window.document;
  const landing = d.querySelector('.qf-landing');
  assert.equal(landing.children[1].getAttribute('data-qf-home-livre'), '');
  assert.ok(!d.querySelector('[data-qf-client-first-tip]'));
  dom.window.close();
});
