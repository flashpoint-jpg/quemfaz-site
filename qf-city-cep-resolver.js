// Impede que o campo "Cidade ou CEP" grave um CEP no lugar do município.
// Só intercepta o formulário do cliente e só quando a entrada é um CEP.
(function () {
  function cepFrom(value) {
    var s = String(value || '').trim();
    if (!/^[0-9Oo.\-\s]{8,13}$/.test(s)) return '';
    var d = s.toUpperCase().replace(/O/g, '0').replace(/\D/g, '');
    return d.length === 8 ? d : '';
  }
  function target(button) {
    var form = button && button.closest('form[data-qf-etapa]');
    var city = form && form.querySelector('input[name="cidade"]');
    if (!city) return null;
    var zip = cepFrom(city.value);
    return zip ? { form: form, city: city, zip: zip } : null;
  }
  function errorAt(city, msg) {
    city.setCustomValidity(msg);
    try { city.reportValidity(); } catch (_) {}
    city.focus();
    city.addEventListener('input', function clear() {
      city.setCustomValidity('');
      city.removeEventListener('input', clear);
    }, { once: true });
  }
  async function translate(item) {
    var lookup = window.QFGeo && window.QFGeo.lookupCep;
    var addr;
    if (typeof lookup === 'function') addr = await lookup(item.zip);
    else {
      var res = await fetch('https://viacep.com.br/ws/' + item.zip + '/json/', { cache: 'no-store' });
      if (!res.ok) throw Error('CEP não encontrado');
      var info = await res.json();
      if (info.erro) throw Error('CEP não encontrado');
      addr = { cidade: info.localidade, uf: info.uf, bairro: info.bairro };
    }
    if (!addr || !addr.cidade || !addr.uf) throw Error('CEP não encontrado');
    item.city.value = addr.cidade;
    item.city.setCustomValidity('');
    item.city.dispatchEvent(new Event('input', { bubbles: true }));
    var uf = item.form.querySelector('[name="uf"]');
    if (uf) {
      uf.value = addr.uf;
      uf.dispatchEvent(new Event('change', { bubbles: true }));
    }
    var bairro = item.form.querySelector('input[name="bairro"]');
    if (bairro && !bairro.value.trim() && addr.bairro) {
      bairro.value = addr.bairro;
      bairro.dispatchEvent(new Event('input', { bubbles: true }));
    }
    item.city.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function ensure(item, go) {
    if (item.form.dataset.qfCepResolving === '1') return;
    item.form.dataset.qfCepResolving = '1';
    translate(item).then(go, function () {
      errorAt(item.city, 'Confira o CEP ou digite o nome da cidade para continuar.');
    }).finally(function () { delete item.form.dataset.qfCepResolving; });
  }
  document.addEventListener('click', function (ev) {
    var button = ev.target.closest && ev.target.closest('[data-qf-sub-ir], button[type="submit"]');
    if (!button) return;
    var item = target(button);
    if (!item) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    ensure(item, function () { if (button.isConnected) button.click(); });
  }, true);
  document.addEventListener('submit', function (ev) {
    var form = ev.target;
    var item = form && form.matches('form[data-qf-etapa]') ? target(form.querySelector('button[type="submit"]')) : null;
    if (!item) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    ensure(item, function () { if (form.isConnected) form.requestSubmit(); });
  }, true);
})();
