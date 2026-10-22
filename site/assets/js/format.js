// Formatação em pt-BR, sempre no fuso do studio.
export const TZ = 'America/Sao_Paulo';

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const formatMoney = (cents) => (cents == null ? null : money.format(cents / 100).replace(/ /g, ' '));

export function formatPrice(service) {
  if (service.price_cents == null) return 'Sob consulta';
  return (service.price_is_starting ? 'a partir de ' : '') + formatMoney(service.price_cents);
}

export function formatDuration(min) {
  if (min == null) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

const fmt = (opts) => new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, ...opts });
const fDateLong = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
const fDateShort = fmt({ weekday: 'short', day: '2-digit', month: '2-digit' });
const fDateFull = fmt({ day: '2-digit', month: '2-digit', year: 'numeric' });
const fTime = fmt({ hour: '2-digit', minute: '2-digit' });
const fMonth = fmt({ month: 'long', year: 'numeric' });

export const formatDateLong = (d) => fDateLong.format(new Date(d));
export const formatDateShort = (d) => fDateShort.format(new Date(d)).replace('.', '');
export const formatDateFull = (d) => fDateFull.format(new Date(d));
export const formatTime = (d) => fTime.format(new Date(d));
export const formatMonth = (d) => fMonth.format(new Date(d));
export const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Data de calendário (YYYY-MM-DD) → objeto Date ao meio-dia UTC, seguro para formatar no fuso do studio.
export const dateFromISO = (iso) => new Date(`${iso}T15:00:00Z`);
export const isoDate = (d) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
export const todayISO = () => isoDate(new Date());
export const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function formatPhone(digits) {
  const d = String(digits || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return digits || '';
}

// Máscara enquanto digita: (35) 99999-9999
export function maskPhoneInput(value) {
  const d = value.replace(/\D/g, '').replace(/^55(?=\d{11})/, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const STATUS_LABEL = {
  pending: 'Pendente', confirmed: 'Confirmado', completed: 'Concluído', cancelled: 'Cancelado', no_show: 'Não compareceu',
};

// Raiz relativa do site (funciona em subpasta, ex.: GitHub Pages).
export const ROOT = document.querySelector('meta[name="lb-root"]')?.content || './';
export const url = (path) => new URL(ROOT + path, location.href).href;

// Imagens: caminho do projeto (images/x/y) → srcset; URL completa (upload no painel) → usa direto.
export function imageTag(path, alt, { sizes = '100vw', className = '', eager = false, widths = [480, 800, 1200] } = {}) {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) {
    return `<img src="${escapeHtml(path)}" alt="${escapeHtml(alt)}" ${eager ? '' : 'loading="lazy"'} decoding="async" class="${className}">`;
  }
  const base = ROOT + path;
  const set = (ext) => widths.map((w) => `${base}-${w}.${ext} ${w}w`).join(', ');
  return `<picture class="${className}"><source type="image/avif" srcset="${set('avif')}" sizes="${sizes}">` +
    `<img src="${base}-800.webp" srcset="${set('webp')}" sizes="${sizes}" alt="${escapeHtml(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"></picture>`;
}

export function toast(message, ms = 4200) {
  const el = document.querySelector('.toast');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, ms);
}
