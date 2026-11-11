'use strict';

const searchForm = document.querySelector('.directory-search');
const searchInput = searchForm.elements.busca;
const catalog = document.querySelector('#catalogo');
const result = catalog.querySelector('[role="status"]');
const reset = catalog.querySelector('.directory-reset');
const cards = [...catalog.querySelectorAll('[data-service]')];
const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

function filterCatalog(query, category, label) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  let count = 0;
  for (const card of cards) {
    card.hidden = (category && card.dataset.category !== category) ||
      !terms.every(term => normalize(card.dataset.service).includes(term));
    if (!card.hidden) count++;
  }
  catalog.open = true;
  reset.hidden = !terms.length && !category;
  result.hidden = reset.hidden;
  result.textContent = count ? label + ' · ' + count + (count === 1 ? ' serviço' : ' serviços') : 'Nenhum serviço encontrado.';
}

searchForm.addEventListener('submit', event => {
  event.preventDefault();
  filterCatalog(searchInput.value, '', searchInput.value.trim());
  catalog.scrollIntoView({ block: 'start' });
  catalog.querySelector('summary').focus({ preventScroll: true });
});

for (const link of document.querySelectorAll('[data-filter]')) {
  link.addEventListener('click', () => {
    searchInput.value = '';
    filterCatalog('', link.dataset.filter, link.textContent.trim());
  });
}

reset.addEventListener('click', () => {
  searchInput.value = '';
  filterCatalog('', '', '');
  catalog.querySelector('summary').focus();
});

document.querySelector('.directory-city select').addEventListener('change', event => {
  if (event.target.value) window.location.assign(event.target.value);
});

function openLinkedDetails() {
  if (!window.location.hash) return;
  const target = document.getElementById(window.location.hash.slice(1));
  const details = target?.closest('details');
  if (details) {
    details.open = true;
    target.scrollIntoView();
  }
}

window.addEventListener('hashchange', openLinkedDetails);
openLinkedDetails();
