// Página de detalhe de um serviço (?s=slug).
import { isConfigured } from './api.js';
import { getPublicSite } from './site.js';
import { formatPrice, formatDuration, escapeHtml, imageTag, ROOT } from './format.js';

const slug = new URLSearchParams(location.search).get('s');
const $ = (s) => document.querySelector(s);

function notFound(msg) {
  $('[data-detail-name]').textContent = 'Serviço não encontrado';
  $('[data-detail-desc]').textContent = msg || 'Esse serviço não está mais disponível. Veja a lista completa.';
  $('[data-detail-book]').href = `${ROOT}servicos/`;
  $('[data-detail-book]').textContent = 'Ver todos os serviços';
  document.title = 'Serviço não encontrado · Studio Ludy Brito';
}

if (!isConfigured()) notFound('O catálogo aparece aqui assim que o sistema de agendamento for configurado.');
else getPublicSite().then((site) => {
  const s = site.services.find((x) => x.slug === slug);
  if (!s) return notFound();
  const cat = site.categories.find((c) => c.id === s.category_id);
  const names = s.professional_ids.map((id) => site.professionals.find((p) => p.id === id)?.name).filter(Boolean);
  document.title = `${s.name} · Studio Ludy Brito, Lavras`;
  document.querySelector('meta[name="description"]')?.setAttribute('content', `${s.name} no Studio Ludy Brito, Centro de Lavras. ${s.summary || ''}`.trim());
  $('[data-detail-media]').innerHTML = s.image_path
    ? imageTag(s.image_path, s.image_alt || s.name, { sizes: '(min-width: 64em) 48vw, 100vw', eager: true })
    : `<div class="catalog-noimg" aria-hidden="true">${escapeHtml(s.name.slice(0, 2))}</div>`;
  $('[data-detail-name]').textContent = s.name;
  $('[data-detail-desc]').textContent = s.description || s.summary || '';
  $('[data-detail-meta]').innerHTML = `
    ${cat ? `<div><dt>Categoria</dt><dd>${escapeHtml(cat.name)}</dd></div>` : ''}
    <div><dt>Duração</dt><dd>${formatDuration(s.duration_minutes)}</dd></div>
    <div><dt>Valor</dt><dd>${escapeHtml(formatPrice(s))}</dd></div>`;
  $('[data-detail-pros]').textContent = names.length ? `Atendimento com ${names.join(', ')}.` : '';
  const book = $('[data-detail-book]');
  if (s.bookable_online && s.professional_ids.length) book.href = `${ROOT}agendamento/?servico=${encodeURIComponent(s.slug)}`;
  else { book.href = `https://wa.me/${site.settings.whatsapp}`; book.textContent = 'Agendar pelo WhatsApp'; }
}).catch(() => notFound('Não foi possível carregar agora. Tente de novo em instantes.'));
