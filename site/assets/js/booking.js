// Fluxo de agendamento: serviço → profissional → data/horário → dados → revisão → confirmação.
// A disponibilidade vem sempre do servidor; o horário é revalidado no momento de confirmar.
import { rpc, isConfigured, newIdempotencyKey, ApiError } from './api.js';
import { getPublicSite } from './site.js';
import {
  formatPrice, formatMoney, formatDuration, formatDateLong, formatTime, formatMonth, capitalize, escapeHtml,
  todayISO, addDays, dateFromISO, maskPhoneInput, formatPhone, imageTag, ROOT, url, toast,
} from './format.js';
import { downloadIcs, googleCalendarUrl } from './calendar-file.js';

const root = document.querySelector('[data-booking]');
const $ = (s, el = root) => el.querySelector(s);
const $$ = (s, el = root) => [...el.querySelectorAll(s)];
const STEPS = ['servico', 'profissional', 'horario', 'dados', 'revisao', 'confirmado'];

const state = {
  site: null,
  services: [],          // ids escolhidos, na ordem
  pro: null,             // id ou null = qualquer
  month: null,           // 'YYYY-MM-01'
  date: null,            // 'YYYY-MM-DD'
  slot: null,            // { start, time, professional_ids }
  client: { nome: '', whatsapp: '', email: '', obs: '' },
  step: 'servico',
  calendar: null,        // resposta do mês
  idemKey: null,
  booking: null,
};

const alertBox = $('[data-booking-alert]');
function showAlert(msg) { alertBox.textContent = msg; alertBox.hidden = !msg; if (msg) alertBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }

const svcById = (id) => state.site.services.find((s) => s.id === id);
const proById = (id) => state.site.professionals.find((p) => p.id === id);
const chosen = () => state.services.map(svcById).filter(Boolean);
const totals = () => {
  const list = chosen();
  return {
    duration: list.reduce((a, s) => a + s.duration_minutes, 0),
    price: list.every((s) => s.price_cents != null) ? list.reduce((a, s) => a + s.price_cents, 0) : null,
    starting: list.some((s) => s.price_is_starting),
  };
};
const eligiblePros = () => state.site.professionals.filter((p) => p.accepts_online_booking
  && state.services.every((sid) => svcById(sid)?.professional_ids.includes(p.id)));

// ------------------------------------------------------------------ navegação entre etapas
function canEnter(step) {
  const i = STEPS.indexOf(step);
  if (i >= 1 && !state.services.length) return false;
  if (i >= 3 && !state.slot) return false;
  if (i >= 4 && !validClient(false)) return false;
  if (step === 'confirmado' && !state.booking) return false;
  return true;
}

function go(step, { push = true, focus = true } = {}) {
  if (step === 'profissional' && eligiblePros().length <= 1) {
    state.pro = eligiblePros()[0]?.id || null;
    step = STEPS.indexOf(state.step) > STEPS.indexOf('profissional') ? 'servico' : 'horario';
  }
  if (!canEnter(step)) return;
  showAlert('');
  state.step = step;
  $$('[data-step]').forEach((s) => { s.hidden = s.dataset.step !== step; });
  const idx = STEPS.indexOf(step);
  $$('[data-step-tab]').forEach((li) => {
    const i = STEPS.indexOf(li.dataset.stepTab);
    li.classList.toggle('is-current', i === idx);
    li.classList.toggle('is-done', i < idx);
    li.querySelector('button').disabled = step === 'confirmado' || !canEnter(li.dataset.stepTab) || i > idx;
    if (i === idx) li.querySelector('button').setAttribute('aria-current', 'step'); else li.querySelector('button').removeAttribute('aria-current');
    li.hidden = li.dataset.stepTab === 'profissional' && eligiblePros().length <= 1;
  });
  root.classList.toggle('is-done', step === 'confirmado');
  if (step === 'horario') enterWhen();
  if (step === 'profissional') renderPros();
  if (step === 'revisao') renderReview();
  if (push) history.pushState({ step }, '', location.search);
  updateSummary();
  if (focus) {
    const h = $(`[data-step="${step}"] .step-title`);
    h?.focus({ preventScroll: true });
    root.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
}
window.addEventListener('popstate', (e) => {
  const step = e.state?.step || 'servico';
  if (state.step === 'confirmado') { history.pushState({ step: 'confirmado' }, '', location.search); return; }
  go(canEnter(step) ? step : 'servico', { push: false });
});

root.addEventListener('click', (e) => {
  const t = e.target.closest('[data-goto]');
  if (t && !t.disabled) go(t.dataset.goto);
  if (e.target.closest('[data-back]')) history.back();
});
$$('[data-next]').forEach((b) => b.addEventListener('click', () => next()));
$('[data-mbar-next]').addEventListener('click', () => {
  if (state.step === 'dados') $('[data-client-form]').requestSubmit();
  else if (state.step === 'revisao') confirm();
  else next();
});
function next() {
  const order = { servico: 'profissional', profissional: 'horario', horario: 'dados' };
  if (order[state.step]) go(order[state.step]);
}

// ------------------------------------------------------------------ serviços
function renderServices() {
  const st = state.site.settings;
  const cats = state.site.categories;
  const bookable = state.site.services.filter((s) => s.bookable_online && s.professional_ids.length);
  $('[data-multi-hint]').textContent = st.allow_multiple_services
    ? `Você pode combinar até ${st.max_services_per_booking} serviços no mesmo horário.`
    : '';
  const byCat = cats.map((c) => ({ c, list: bookable.filter((s) => s.category_id === c.id) }))
    .concat([{ c: { name: 'Outros' }, list: bookable.filter((s) => !cats.some((c) => c.id === s.category_id)) }])
    .filter((g) => g.list.length);
  const multi = st.allow_multiple_services && st.max_services_per_booking > 1;
  $('[data-service-picker]').innerHTML = byCat.map(({ c, list }) => `
    <fieldset class="svc-fieldset">
      <legend>${escapeHtml(c.name)}</legend>
      ${list.map((s) => `
        <label class="svc-option">
          <input type="${multi ? 'checkbox' : 'radio'}" name="servico" value="${s.id}">
          <span class="svc-thumb">${s.image_path ? imageTag(s.image_path, '', { sizes: '96px', widths: [480] }) : ''}</span>
          <span class="svc-text">
            <span class="svc-name">${escapeHtml(s.name)}</span>
            ${s.summary ? `<span class="svc-sum">${escapeHtml(s.summary)}</span>` : ''}
            ${!s.combinable && multi ? '<span class="svc-sum">Agendado sozinho.</span>' : ''}
          </span>
          <span class="svc-meta"><span>${escapeHtml(formatPrice(s))}</span><span class="muted">${formatDuration(s.duration_minutes)}</span></span>
        </label>`).join('')}
    </fieldset>`).join('') || '<p>Nenhum serviço disponível para agendamento online no momento. Fale com a gente pelo WhatsApp.</p>';
  $('[data-service-picker]').addEventListener('change', onServiceChange);
  syncServiceInputs();
}

function onServiceChange(e) {
  const input = e.target;
  if (input.name !== 'servico') return;
  const st = state.site.settings;
  const s = svcById(input.value);
  if (input.type === 'radio') state.services = [input.value];
  else if (input.checked) {
    const others = chosen();
    if (!s.combinable || others.some((o) => !o.combinable)) {
      state.services = [input.value];
      if (others.length) toast(`${s.combinable ? 'O serviço anterior' : s.name} é agendado sozinho. Seleção atualizada.`);
    } else if (state.services.length >= st.max_services_per_booking) {
      input.checked = false;
      toast(`Escolha no máximo ${st.max_services_per_booking} serviços por agendamento.`);
      return;
    } else state.services.push(input.value);
  } else state.services = state.services.filter((x) => x !== input.value);
  // mudar serviços invalida profissional e horário escolhidos
  if (state.pro && !eligiblePros().some((p) => p.id === state.pro)) state.pro = null;
  state.slot = null; state.calendar = null;
  syncServiceInputs();
  updateSummary();
}

function syncServiceInputs() {
  $$('input[name="servico"]').forEach((i) => {
    i.checked = state.services.includes(i.value);
    i.closest('.svc-option').classList.toggle('is-on', i.checked);
  });
  $('[data-next="servico"]').disabled = !state.services.length;
}

// ------------------------------------------------------------------ profissional
function renderPros() {
  const pros = eligiblePros();
  const opt = (id, name, note) => `
    <label class="pro-option${state.pro === id ? ' is-on' : ''}">
      <input type="radio" name="pro" value="${id || ''}" ${state.pro === id ? 'checked' : ''}>
      <span class="pro-name">${escapeHtml(name)}</span>
      ${note ? `<span class="muted">${escapeHtml(note)}</span>` : ''}
    </label>`;
  $('[data-pro-picker]').innerHTML = opt(null, 'Qualquer profissional disponível', 'Mostra mais horários') +
    pros.map((p) => opt(p.id, p.name, p.bio || '')).join('');
  $('[data-pro-picker]').onchange = (e) => {
    state.pro = e.target.value || null;
    state.slot = null; state.calendar = null;
    $$('.pro-option').forEach((l) => l.classList.toggle('is-on', l.querySelector('input').checked));
    updateSummary();
  };
}

// ------------------------------------------------------------------ calendário e horários
const params = new URLSearchParams(location.search);
let calToken = 0;

async function enterWhen() {
  const today = todayISO();
  if (!state.month) state.month = (state.date || today).slice(0, 7) + '-01';
  await loadMonth();
  if (state.date) await loadSlots(state.date);
}

function monthBounds() {
  const today = todayISO();
  const max = addDays(today, state.site.settings.max_advance_days);
  return { min: today.slice(0, 7) + '-01', max: max.slice(0, 7) + '-01', today, maxDay: max };
}

async function loadMonth() {
  const token = ++calToken;
  const b = monthBounds();
  $('[data-cal-month]').textContent = capitalize(formatMonth(dateFromISO(state.month)));
  $('[data-cal-prev]').disabled = state.month <= b.min;
  $('[data-cal-next]').disabled = state.month >= b.max;
  $('[data-cal-grid]').setAttribute('aria-busy', 'true');
  renderCalendar(null);
  try {
    const cal = await rpc('get_availability_calendar', {
      p_service_ids: state.services, p_professional_id: state.pro, p_month: state.month,
    });
    if (token !== calToken) return;
    state.calendar = cal;
    renderCalendar(cal);
    const anyAvailable = cal.days.some((d) => d.available);
    if (!anyAvailable && !state.date) {
      $('[data-slots-msg]').textContent = state.month < b.max
        ? 'Nenhum horário livre neste mês. Veja o próximo mês.'
        : 'Nenhum horário livre no período aberto para agendamento. Fale com a gente pelo WhatsApp.';
    }
  } catch (err) {
    if (token !== calToken) return;
    showAlert(err.message);
  } finally {
    if (token === calToken) $('[data-cal-grid]').removeAttribute('aria-busy');
  }
}

function renderCalendar(cal) {
  const first = new Date(`${state.month}T12:00:00Z`);
  const startDow = first.getUTCDay();
  const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const info = new Map((cal?.days || []).map((d) => [d.date, d]));
  const rows = [];
  let cells = [];
  for (let i = 0; i < startDow; i++) cells.push('<td role="gridcell"></td>');
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${state.month.slice(0, 8)}${String(d).padStart(2, '0')}`;
    const day = info.get(iso);
    const available = Boolean(day?.available);
    const selected = state.date === iso;
    const label = `${capitalize(formatDateLong(dateFromISO(iso)))}${cal ? (available ? `, ${day.slots} horário${day.slots === 1 ? '' : 's'} livre${day.slots === 1 ? '' : 's'}` : ', sem horários') : ''}`;
    cells.push(`<td role="gridcell"${selected ? ' aria-selected="true"' : ''}>
      <button type="button" class="cal-day${available ? ' is-open' : ''}${selected ? ' is-selected' : ''}${iso === todayISO() ? ' is-today' : ''}"
        data-day="${iso}" aria-label="${escapeHtml(label)}" ${available ? '' : 'aria-disabled="true"'} tabindex="-1">${d}</button></td>`);
    if (cells.length === 7) { rows.push(`<tr>${cells.join('')}</tr>`); cells = []; }
  }
  if (cells.length) { while (cells.length < 7) cells.push('<td role="gridcell"></td>'); rows.push(`<tr>${cells.join('')}</tr>`); }
  $('[data-cal-body]').innerHTML = rows.join('');
  // roving tabindex: um único dia focável
  const focusable = $('.cal-day.is-selected') || $('.cal-day.is-open') || $('.cal-day');
  if (focusable) focusable.tabIndex = 0;
}

$('[data-cal-prev]').addEventListener('click', () => shiftMonth(-1));
$('[data-cal-next]').addEventListener('click', () => shiftMonth(1));
function shiftMonth(n) {
  const d = new Date(`${state.month}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  state.month = d.toISOString().slice(0, 10);
  loadMonth();
}

$('[data-cal-body]').addEventListener('click', (e) => {
  const b = e.target.closest('.cal-day');
  if (!b) return;
  if (b.getAttribute('aria-disabled') === 'true') { toast('Esse dia não tem horários livres.'); return; }
  selectDay(b.dataset.day);
});
$('[data-cal-body]').addEventListener('keydown', (e) => {
  const b = e.target.closest('.cal-day');
  if (!b) return;
  const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  if (e.key in moves) {
    e.preventDefault();
    const target = addDays(b.dataset.day, moves[e.key]);
    const el = $(`.cal-day[data-day="${target}"]`);
    if (el) { b.tabIndex = -1; el.tabIndex = 0; el.focus(); }
    else if (target.slice(0, 7) !== state.month.slice(0, 7)) {
      const dir = target > b.dataset.day ? 1 : -1;
      const btn = $(dir > 0 ? '[data-cal-next]' : '[data-cal-prev]');
      if (!btn.disabled) shiftMonth(dir);
    }
  }
});

async function selectDay(iso) {
  state.date = iso;
  state.slot = null;
  $$('.cal-day').forEach((b) => {
    const on = b.dataset.day === iso;
    b.classList.toggle('is-selected', on);
    b.closest('td').toggleAttribute('aria-selected', on);
    if (on) b.closest('td').setAttribute('aria-selected', 'true');
  });
  updateSummary();
  await loadSlots(iso);
}

let slotToken = 0;
async function loadSlots(iso) {
  const token = ++slotToken;
  const box = $('[data-slots]');
  box.innerHTML = `<p class="slots-empty muted" aria-live="polite">Buscando horários livres…</p>`;
  $('[data-next="horario"]').disabled = true;
  try {
    const res = await rpc('get_available_slots', {
      p_service_ids: state.services, p_date: iso, p_professional_id: state.pro,
    });
    if (token !== slotToken) return;
    renderSlots(res.slots, iso);
  } catch (err) {
    if (token !== slotToken) return;
    box.innerHTML = `<p class="slots-empty">${escapeHtml(err.message)}</p>`;
  }
}

function renderSlots(slots, iso) {
  const box = $('[data-slots]');
  if (!slots.length) {
    box.innerHTML = `<p class="slots-empty">Não há mais horários livres em ${escapeHtml(formatDateLong(dateFromISO(iso)))}. Escolha outro dia.</p>`;
    return;
  }
  const groups = [['manha', 'Manhã'], ['tarde', 'Tarde'], ['noite', 'Noite']]
    .map(([k, label]) => ({ label, list: slots.filter((s) => s.period === k) })).filter((g) => g.list.length);
  box.innerHTML = `<h3 class="slots-title">${escapeHtml(capitalize(formatDateLong(dateFromISO(iso))))}</h3>` +
    groups.map((g) => `
      <div class="slot-group" role="radiogroup" aria-label="${g.label}">
        <p class="slot-label">${g.label}</p>
        <div class="slot-buttons">
          ${g.list.map((s) => `<button type="button" class="slot" role="radio" aria-checked="${state.slot?.start === s.start}"
              data-start="${s.start}">${s.time}</button>`).join('')}
        </div>
      </div>`).join('');
  box.querySelectorAll('.slot').forEach((b, i) => { b.tabIndex = (state.slot ? b.getAttribute('aria-checked') === 'true' : i === 0) ? 0 : -1; });
  box.onclick = (e) => {
    const b = e.target.closest('.slot');
    if (!b) return;
    state.slot = slots.find((s) => s.start === b.dataset.start);
    box.querySelectorAll('.slot').forEach((x) => { x.setAttribute('aria-checked', String(x === b)); x.tabIndex = x === b ? 0 : -1; });
    $('[data-next="horario"]').disabled = false;
    updateSummary();
  };
  box.onkeydown = (e) => {
    const b = e.target.closest('.slot');
    if (!b || !['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const all = [...box.querySelectorAll('.slot')];
    const i = all.indexOf(b) + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1);
    const t = all[(i + all.length) % all.length];
    b.tabIndex = -1; t.tabIndex = 0; t.focus();
  };
  // horário vindo de um link (ex.: "próximo horário livre" da página inicial)
  const wanted = params.get('hora');
  if (wanted && !state.slot && params.get('data') === iso) {
    const btn = [...box.querySelectorAll('.slot')].find((b) => b.textContent.trim() === wanted);
    btn?.click();
    params.delete('hora');
  }
  $('[data-next="horario"]').disabled = !state.slot;
}

// ------------------------------------------------------------------ dados da cliente
const form = $('[data-client-form]');
const phoneInput = form.querySelector('[name="whatsapp"]');
phoneInput.addEventListener('input', () => {
  const pos = phoneInput.selectionStart === phoneInput.value.length;
  phoneInput.value = maskPhoneInput(phoneInput.value);
  if (pos) phoneInput.setSelectionRange(phoneInput.value.length, phoneInput.value.length);
});
form.querySelector('[name="obs"]').addEventListener('input', (e) => { $('[data-obs-count]').textContent = e.target.value.length; });

function setError(name, msg) {
  const el = form.querySelector(`[data-error-for="${name}"]`);
  const input = form.querySelector(`[name="${name}"]`);
  if (el) el.textContent = msg || '';
  if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  return !msg;
}

function validClient(show = true) {
  const v = Object.fromEntries(new FormData(form).entries());
  const digits = (v.whatsapp || '').replace(/\D/g, '');
  const errs = {
    nome: (v.nome || '').trim().replace(/\s+/g, ' ').length < 3 || !/\s/.test((v.nome || '').trim()) ? 'Informe nome e sobrenome.' : '',
    whatsapp: !/^[1-9][0-9]9?[0-9]{8}$/.test(digits) ? 'Informe um WhatsApp válido com DDD, ex.: (35) 99999-9999.' : '',
    email: v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email.trim()) ? 'Confira o e-mail informado.' : '',
    politica: !v.politica ? 'É preciso aceitar a política para concluir.' : '',
    privacidade: !v.privacidade ? 'É preciso autorizar o uso dos dados para este agendamento.' : '',
  };
  if (show) Object.entries(errs).forEach(([k, m]) => setError(k, m));
  const ok = Object.values(errs).every((m) => !m);
  if (ok) state.client = { nome: v.nome.trim().replace(/\s+/g, ' '), whatsapp: digits, email: (v.email || '').trim(), obs: (v.obs || '').trim() };
  if (show && !ok) form.querySelector('[aria-invalid="true"]')?.focus();
  return ok;
}
form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (validClient(true)) go('revisao');
});
form.addEventListener('input', (e) => { if (e.target.getAttribute('aria-invalid') === 'true') setError(e.target.name, ''); });

// ------------------------------------------------------------------ revisão e confirmação
function reviewRows(b) {
  const t = totals();
  const pro = b ? b.professional.name : state.pro ? proById(state.pro)?.name : (state.slot?.professional_ids.length === 1 ? proById(state.slot.professional_ids[0])?.name : 'Qualquer profissional disponível');
  const start = b ? b.starts_at : state.slot.start;
  const price = b ? b.total_price_cents : t.price;
  const services = b ? b.services.map((s) => s.name).join(' + ') : chosen().map((s) => s.name).join(' + ');
  const rows = [
    ['Serviço', services],
    ['Profissional', pro],
    ['Data', capitalize(formatDateLong(start))],
    ['Horário', formatTime(start)],
    ['Duração', formatDuration(b ? b.duration_minutes : t.duration)],
    ['Valor', price == null ? 'Sob consulta' : (t.starting && !b ? 'a partir de ' : '') + formatMoney(price)],
    ['Cliente', b ? b.client.name : state.client.nome],
    ['WhatsApp', b ? b.client.phone_masked : formatPhone(state.client.whatsapp)],
  ];
  if (!b && state.client.email) rows.push(['E-mail', state.client.email]);
  if (!b && state.client.obs) rows.push(['Observações', state.client.obs]);
  return rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`).join('');
}

function renderReview() {
  $('[data-review]').innerHTML = reviewRows(null);
  if (!state.idemKey) state.idemKey = newIdempotencyKey();
}

let submitting = false;
$('[data-confirm]').addEventListener('click', confirm);
async function confirm() {
  if (submitting || state.step !== 'revisao') return;
  submitting = true;
  const btn = $('[data-confirm]');
  btn.disabled = true; btn.textContent = 'Confirmando…';
  $('[data-mbar-next]').disabled = true;
  try {
    const b = await rpc('create_booking', {
      p_service_ids: state.services,
      p_start: state.slot.start,
      p_full_name: state.client.nome,
      p_phone: state.client.whatsapp,
      p_professional_id: state.pro,
      p_email: state.client.email || null,
      p_notes: state.client.obs || null,
      p_accept_policy: true,
      p_accept_privacy: true,
      p_idempotency_key: state.idemKey,
    });
    state.booking = b;
    rememberBooking(b);
    renderDone(b);
    go('confirmado');
    history.replaceState({ step: 'confirmado' }, '', location.pathname);
  } catch (err) {
    if (err instanceof ApiError && err.code === 'SLOT_TAKEN') {
      state.slot = null; state.idemKey = null;
      go('horario');
      showAlert(err.message);
    } else if (err instanceof ApiError && ['INVALID_PHONE', 'INVALID_NAME', 'INVALID_EMAIL', 'CONSENT_REQUIRED'].includes(err.code)) {
      state.idemKey = null;
      go('dados');
      showAlert(err.message);
    } else {
      showAlert(`${err.message} Seu agendamento ainda não foi feito.`);
    }
  } finally {
    submitting = false;
    btn.disabled = false; btn.textContent = 'Confirmar agendamento';
    updateSummary();
  }
}

function manageUrl(b) { return url(`meus-agendamentos/?p=${encodeURIComponent(b.protocol)}&t=${encodeURIComponent(b.token)}`); }

function rememberBooking(b) {
  try {
    const list = JSON.parse(localStorage.getItem('lb.bookings') || '[]').filter((x) => x.p !== b.protocol);
    list.unshift({ p: b.protocol, t: b.token, s: b.starts_at });
    localStorage.setItem('lb.bookings', JSON.stringify(list.slice(0, 10)));
  } catch { /* sem armazenamento local */ }
}

function renderDone(b) {
  const st = state.site.settings;
  const pending = b.status === 'pending';
  $('[data-done-title]').textContent = pending ? 'Agendamento recebido' : 'Agendamento confirmado';
  $('[data-done-lead]').textContent = pending
    ? 'Seu horário está reservado e aguarda a confirmação do studio. Se precisar, fale com a gente pelo WhatsApp.'
    : 'Tudo certo. Seu horário está confirmado.';
  $('[data-done-protocol]').textContent = b.protocol;
  $('[data-done-review]').innerHTML = reviewRows(b);
  const link = manageUrl(b);
  const a = $('[data-done-manage]');
  a.href = link; a.textContent = link.replace(/^https?:\/\//, '');
  const msg = `Olá! Acabei de agendar pelo site.\n\nProtocolo: ${b.protocol}\nServiço: ${b.services.map((s) => s.name).join(' + ')}\n` +
    `Data: ${capitalize(formatDateLong(b.starts_at))}, às ${formatTime(b.starts_at)}\nProfissional: ${b.professional.name}\nNome: ${b.client.name}`;
  $('[data-done-whatsapp]').href = `https://wa.me/${st.whatsapp}?text=${encodeURIComponent(msg)}`;
  const ev = {
    uid: `${b.protocol}@studioludybrito`, start: b.starts_at, end: b.ends_at,
    title: `${b.services.map((s) => s.name).join(' + ')} · Studio Ludy Brito`,
    location: `${st.address_line}, ${st.neighborhood}, ${st.city} - ${st.state}`,
    description: `Protocolo ${b.protocol}. Para consultar, reagendar ou cancelar: ${link}`,
  };
  $('[data-done-ics]').onclick = () => downloadIcs(ev, `agendamento-${b.protocol}.ics`);
  $('[data-done-gcal]').href = googleCalendarUrl(ev);
  $('[data-copy-manage]').onclick = async () => {
    try { await navigator.clipboard.writeText(link); toast('Link copiado.'); } catch { toast('Não foi possível copiar. Selecione o link e copie manualmente.'); }
  };
}

// ------------------------------------------------------------------ resumo lateral e barra do celular
function updateSummary() {
  if (!state.site) return;
  const t = totals();
  const list = chosen();
  const set = (k, v) => { const el = $(`[data-sum="${k}"]`); if (el) el.textContent = v; };
  set('services', list.length ? list.map((s) => s.name).join(' + ') : 'Escolha um serviço');
  const proName = state.pro ? proById(state.pro)?.name
    : eligiblePros().length === 1 ? eligiblePros()[0].name
    : state.slot?.professional_ids?.length === 1 ? proById(state.slot.professional_ids[0])?.name : 'Qualquer disponível';
  set('pro', list.length ? proName : '—');
  set('date', state.date ? capitalize(formatDateLong(dateFromISO(state.date))) : '—');
  set('time', state.slot ? formatTime(state.slot.start) : '—');
  set('duration', list.length ? formatDuration(t.duration) : '—');
  set('price', !list.length ? '—' : t.price == null ? 'Sob consulta' : (t.starting ? 'a partir de ' : '') + formatMoney(t.price));

  const l1 = $('[data-mbar-line1]');
  const l2 = $('[data-mbar-line2]');
  const nb = $('[data-mbar-next]');
  l1.textContent = list.length ? list.map((s) => s.name).join(' + ') : 'Escolha um serviço';
  l2.textContent = list.length ? [state.slot ? `${formatDateLong(state.slot.start)}, ${formatTime(state.slot.start)}` : null,
    t.price == null ? null : formatMoney(t.price)].filter(Boolean).join(' · ') : '';
  const labels = { servico: 'Continuar', profissional: 'Continuar', horario: 'Continuar', dados: 'Revisar', revisao: 'Confirmar' };
  nb.textContent = labels[state.step] || 'Continuar';
  nb.disabled = submitting
    || (state.step === 'servico' && !list.length)
    || (state.step === 'horario' && !state.slot);
  $('[data-mobile-bar]').hidden = state.step === 'confirmado';
}

// ------------------------------------------------------------------ início
async function init() {
  if (!isConfigured()) {
    $('[data-service-picker]').innerHTML = '<p>O agendamento online ainda não foi configurado. Fale com a gente pelo WhatsApp.</p>';
    return;
  }
  try {
    state.site = await getPublicSite();
  } catch (err) {
    $('[data-service-picker]').innerHTML = `<p>Não foi possível carregar a agenda agora. ${escapeHtml(err.message || '')}</p>`;
    return;
  }
  const policy = [state.site.settings.booking_policy, state.site.settings.cancellation_policy].filter(Boolean);
  if (policy.length) $('[data-policy-text]').innerHTML = policy.map((p) => `<p>${escapeHtml(p)}</p>`).join('');
  renderServices();
  const pre = params.get('servico');
  const svc = pre && state.site.services.find((s) => s.slug === pre && s.bookable_online);
  history.replaceState({ step: 'servico' }, '', location.search);
  if (svc) {
    state.services = [svc.id];
    syncServiceInputs();
    const d = params.get('data');
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) { state.date = d; state.month = d.slice(0, 7) + '-01'; }
    go(eligiblePros().length > 1 ? 'profissional' : 'horario', { focus: false });
  } else {
    go('servico', { push: false, focus: false });
  }
}
init();
