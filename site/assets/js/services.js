// Catálogo de serviços: categorias, filtros e busca (dados do banco).
import { isConfigured } from './api.js';
import { getPublicSite, observeReveals } from './site.js';
import { formatPrice, formatDuration, escapeHtml, imageTag, ROOT } from './format.js';

const list = document.querySelector('[data-catalog-list]');
const filters = document.querySelector('[data-catalog-filters]');
const search = document.querySelector('[data-catalog-search]');
const count = document.querySelector('[data-catalog-count]');
const status = document.querySelector('[data-catalog-status]');

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function render(site, cat, q) {
  const cats = new Map(site.categories.map((c) => [c.id, c]));
  const pros = new Map(site.professionals.map((p) => [p.id, p]));
  const items = site.services.filter((s) => (!cat || s.category_id === cat)
    && (!q || norm(`${s.name} ${s.summary} ${s.description} ${cats.get(s.category_id)?.name}`).includes(norm(q))));
  count.textContent = `${items.length} serviço${items.length === 1 ? '' : 's'} encontrado${items.length === 1 ? '' : 's'}`;
  if (!items.length) {
    list.innerHTML = `<p class="catalog-empty">Nenhum serviço encontrado${q ? ` para “${escapeHtml(q)}”` : ''}. <button class="link-plain" type="button" data-clear>Limpar filtros</button></p>`;
    list.querySelector('[data-clear]').addEventListener('click', () => { search.value = ''; setCat(''); });
    return;
  }
  list.innerHTML = items.map((s) => {
    const detail = `${ROOT}servicos/detalhe/?s=${encodeURIComponent(s.slug)}`;
    const names = s.professional_ids.map((id) => pros.get(id)?.name).filter(Boolean);
    const media = s.image_path
      ? imageTag(s.image_path, s.image_alt || s.name, { sizes: '(min-width: 64em) 30vw, 78vw' })
      : `<div class="catalog-noimg" aria-hidden="true">${escapeHtml(s.name.slice(0, 2))}</div>`;
    return `<article class="catalog-item" data-reveal>
      ${media}
      <div class="catalog-text">
        <p class="catalog-cat">${escapeHtml(cats.get(s.category_id)?.name || 'Serviço')}</p>
        <h2><a href="${detail}">${escapeHtml(s.name)}</a></h2>
        ${s.summary ? `<p class="catalog-desc">${escapeHtml(s.summary)}</p>` : ''}
        <dl class="catalog-meta">
          <div><dt>Duração</dt><dd>${formatDuration(s.duration_minutes)}</dd></div>
          <div><dt>Valor</dt><dd>${escapeHtml(formatPrice(s))}</dd></div>
          ${names.length ? `<div><dt>Com</dt><dd>${escapeHtml(names.join(', '))}</dd></div>` : ''}
        </dl>
        <p class="catalog-actions">
          ${s.bookable_online && s.professional_ids.length
            ? `<a class="button" href="${ROOT}agendamento/?servico=${encodeURIComponent(s.slug)}">Agendar</a>`
            : '<span class="muted">Agendamento pelo WhatsApp</span>'}
          <a class="link-arrow" href="${detail}">Detalhes</a>
        </p>
      </div>
    </article>`;
  }).join('');
  observeReveals(list);
}

let site = null;
let current = new URLSearchParams(location.search).get('categoria') || '';
function setCat(slugOrId) {
  const cat = site.categories.find((c) => c.slug === slugOrId || c.id === slugOrId);
  current = cat ? cat.id : '';
  filters.querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cat === current)));
  const u = new URL(location.href);
  if (cat) u.searchParams.set('categoria', cat.slug); else u.searchParams.delete('categoria');
  history.replaceState(null, '', u);
  render(site, current, search.value.trim());
}

if (!isConfigured()) {
  status.textContent = 'O catálogo aparece aqui assim que o sistema de agendamento for configurado.';
} else {
  getPublicSite().then((data) => {
    site = data;
    filters.insertAdjacentHTML('beforeend', site.categories
      .filter((c) => site.services.some((s) => s.category_id === c.id))
      .map((c) => `<button class="chip" type="button" aria-pressed="false" data-cat="${c.id}">${escapeHtml(c.name)}</button>`).join(''));
    filters.addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (b) setCat(b.dataset.cat); });
    let t;
    search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => render(site, current, search.value.trim()), 120); });
    setCat(current);
  }).catch(() => {
    status.textContent = 'Não foi possível carregar os serviços agora. Tente de novo em instantes ou fale pelo WhatsApp.';
  });
}
