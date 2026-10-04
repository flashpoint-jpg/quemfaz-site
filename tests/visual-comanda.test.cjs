const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// Scripts continuam com sintaxe válida.
[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, i) => new vm.Script(m[1], { filename: 'inline-' + i + '.js' }));

// O visual novo nunca vale para a tela inicial: toda regra do bloco que mexe em algo
// que já existia no app vem presa a "#app-shell" com rota diferente de "inicio".
const m = html.match(/<style id="qf-skin-comanda">([\s\S]*?)<\/style>/);
assert.ok(m, 'bloco do visual novo');
const css = m[1].replace(/\/\*[\s\S]*?\*\//g, '');
const seletores = [];
css.replace(/@media[^{]+\{/g, '').split('}').forEach((bloco) => {
  const sel = bloco.split('{')[0].trim();
  if (sel) sel.split(',').forEach((x) => seletores.push(x.trim()));
});
assert.ok(seletores.length > 30);
seletores.forEach((sel) => {
  const novo = /^\.qf-(perf|ticket|tape|hero|steps|step|now-title)/.test(sel);
  const preso = sel.startsWith('#app-shell:not([data-route="inicio"])') || /^#app-shell\[data-route="(cliente-home|profissional-chamada)"\]/.test(sel);
  assert.ok(novo || preso, 'regra solta que poderia mudar a tela inicial: ' + sel);
});

// V11.24: a tela inicial ganhou trena, etiqueta e botões grandes, mas a FOTO e a BUSCA
// automática continuam exatamente como eram.
const a = html.indexOf("'<section class=\"qf-landing-hero\">");
assert.ok(a > 0);
const landing = html.slice(a, html.indexOf('};', a));
assert.ok(landing.includes('<div class="qf-landing-photo"><img src="\' + heroBanner + \'" width="1200" height="800" alt="QuemFaz: Precisou? Encontre quem faz. Serviços, reparos e soluções perto de você."></div>'));
assert.ok(landing.includes('<form class="qf-landing-service-search qf-hero-search" data-landing-service-form><label class="qf-hero-search__label" for="qf-hero-search-input">Do que você precisa?</label>'));
assert.ok(landing.includes('data-landing-service-search placeholder="Ex.: chuveiro não esquenta" autocomplete="off" enterkeyhint="search">'));
assert.ok(landing.includes('<div class="qf-service-suggestions" data-landing-service-suggestions hidden></div></form>'));
const css2 = (html.match(/<style id="qf-skin-inicio">([\s\S]*?)<\/style>/) || [])[1] || '';
assert.ok(css2.length > 500);
assert.ok(!/qf-landing-photo|qf-hero-search \.|qf-hero-search\{|\.qf-landing-photo img/.test(css2.replace(/\/\*[\s\S]*?\*\//g, '')), 'o visual novo não pode mexer na foto nem no campo de busca');
// Nada de função perdida no início: entrar, instalar, ajuda, profissional, anúncio e preços.
['data-action="landing-login"', 'data-support-open>Ajuda', 'data-nav="/auth/profissional/login"', 'data-nav="/anuncie"', 'data-nav="/como-funciona"'].forEach((x) => assert.ok(landing.includes(x) || html.includes(x), x));
assert.ok(landing.includes('Ele chama você no WhatsApp'));

// Pedir serviço: mesmos campos, anúncio depois do botão.
const r = html.indexOf('<div class="qf-req-steps"');
const pedir = html.slice(r, html.indexOf("'</div>'\n    );\n  }", r));
['servicoField', 'regionField', 'name="descricao" required minlength="8"', 'name="telefone" type="tel"', 'name="nome" autocomplete="name" required', 'qf-request-submit'].forEach((x) => assert.ok(pedir.includes(x), x));
assert.ok(pedir.indexOf('qf-request-submit') < pedir.indexOf('cadastroClienteAdsHtml()'));

// Peças do visual novo no lugar.
assert.ok(html.includes('<h1 class="qf-hero__title">O que você precisa hoje?</h1>'));
assert.ok(html.includes("['Publicado', 'Em contato', 'Serviço feito', 'Avaliação']"));
assert.ok(html.includes('class="card stack qf-ticket" data-qf-fechamento'));
assert.ok(html.includes(".replace('<!--qf-chat-->', cta)"));
assert.ok(html.includes('data-action="fechei-servico"') && html.includes('data-action="nao-fechei-servico"'));
console.log('visual-comanda: ok');
