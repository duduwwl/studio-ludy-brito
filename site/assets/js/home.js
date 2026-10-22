// Página inicial: serviços do banco, próximo horário livre ao vivo e a troca lenta das fotos do hero.
import { rpc, isConfigured } from './api.js';
import { getPublicSite } from './site.js';
import { formatPrice, formatDuration, formatDateLong, formatTime, capitalize, escapeHtml, todayISO, ROOT } from './format.js';

// --- troca lenta de fotos (assinatura de movimento) ---
(() => {
  const box = document.querySelector('[data-crossfade]');
  if (!box || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const frames = [...box.querySelectorAll('picture')];
  if (frames.length < 2) return;
  let i = 0;
  let timer = null;
  const tick = () => {
    frames[i].classList.remove('is-on');
    i = (i + 1) % frames.length;
    frames[i].classList.add('is-on');
  };
  const start = () => { if (!timer) timer = setInterval(tick, 5600); };
  const stop = () => { clearInterval(timer); timer = null; };
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  start();
})();

// --- serviços em tabela ---
async function renderServices(site) {
  const box = document.querySelector('[data-service-table]');
  if (!box) return;
  const cats = new Map(site.categories.map((c) => [c.id, c]));
  const groups = new Map();
  for (const s of site.services) {
    const key = s.category_id || 'outros';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  if (!site.services.length) {
    box.innerHTML = '<p class="muted">Os serviços estão sendo atualizados. Fale com a gente pelo WhatsApp.</p>';
    return;
  }
  box.innerHTML = [...groups.entries()].map(([cid, list]) => `
    <div class="svc-group" role="list">
      ${list.map((s) => `
        <a class="svc-row" role="listitem" href="${ROOT}servicos/detalhe/?s=${encodeURIComponent(s.slug)}">
          <span class="svc-kind">${escapeHtml(cats.get(cid)?.name || 'Outros')}</span>
          <span class="svc-name">${escapeHtml(s.name)}</span>
          <span class="svc-value">${escapeHtml(formatPrice(s))}<small>${formatDuration(s.duration_minutes)}</small></span>
        </a>`).join('')}
    </div>`).join('');
}

// --- próximo horário livre (a coisa viva da página) ---
async function nextSlot(serviceId) {
  const today = todayISO();
  let month = today.slice(0, 7) + '-01';
  for (let k = 0; k < 3; k++) {
    const cal = await rpc('get_availability_calendar', { p_service_ids: [serviceId], p_professional_id: null, p_month: month });
    const day = cal.days.find((d) => d.available && d.date >= today);
    if (day) {
      const res = await rpc('get_available_slots', { p_service_ids: [serviceId], p_date: day.date });
      if (res.slots.length) return { date: day.date, slot: res.slots[0] };
    }
    const d = new Date(`${month}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1);
    month = d.toISOString().slice(0, 10);
  }
  return null;
}

async function setupNextSlot(site) {
  const box = document.querySelector('[data-next-slot]');
  const fallback = document.querySelector('[data-next-slot-fallback]');
  const select = box?.querySelector('[data-next-slot-service]');
  const value = box?.querySelector('[data-next-slot-value]');
  const link = box?.querySelector('[data-next-slot-link]');
  const bookable = site.services.filter((s) => s.bookable_online && s.professional_ids.length);
  if (!box || !bookable.length) return;
  select.innerHTML = bookable.map((s) => `<option value="${s.id}">${escapeHtml(s.name.toLowerCase())}</option>`).join('');
  const update = async () => {
    const id = select.value;
    value.textContent = 'consultando a agenda…';
    link.setAttribute('aria-disabled', 'true');
    try {
      const r = await nextSlot(id);
      if (select.value !== id) return;
      if (!r) {
        value.textContent = 'Sem horários livres nos próximos dias. Fale pelo WhatsApp.';
        return;
      }
      value.textContent = `${capitalize(formatDateLong(r.slot.start))}, às ${formatTime(r.slot.start)}`;
      const svc = bookable.find((s) => s.id === id);
      link.href = `${ROOT}agendamento/?servico=${encodeURIComponent(svc.slug)}&data=${r.date}&hora=${encodeURIComponent(r.slot.time)}`;
      link.removeAttribute('aria-disabled');
    } catch {
      value.textContent = 'Não foi possível consultar a agenda agora.';
    }
  };
  select.addEventListener('change', update);
  box.hidden = false;
  fallback.hidden = true;
  await update();
}

if (isConfigured()) {
  getPublicSite().then((site) => {
    renderServices(site);
    setupNextSlot(site);
  }).catch(() => {
    const st = document.querySelector('[data-service-table-status]');
    if (st) st.textContent = 'Não foi possível carregar os serviços agora. Veja a página de serviços ou fale pelo WhatsApp.';
  });
} else {
  const st = document.querySelector('[data-service-table-status]');
  if (st) st.textContent = 'A lista de serviços aparece aqui assim que o sistema de agendamento for configurado.';
}
