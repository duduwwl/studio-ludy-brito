// Área da cliente: link seguro (protocolo + token) ou login por código no e-mail.
import { rpc, auth, getSession, isConfigured } from './api.js';
import {
  formatDateLong, formatDateShort, formatTime, formatDuration, formatMoney, capitalize, escapeHtml,
  STATUS_LABEL, todayISO, addDays, dateFromISO, toast,
} from './format.js';

const $ = (s) => document.querySelector(s);
const alertBox = $('[data-account-alert]');
const showAlert = (m) => { alertBox.textContent = m || ''; alertBox.hidden = !m; };
const params = new URLSearchParams(location.search);

function card(b, { actions = true } = {}) {
  const services = b.services.map((s) => s.name).join(' + ');
  const price = b.total_price_cents == null ? 'Sob consulta' : formatMoney(b.total_price_cents);
  return `<article class="appt" data-protocol="${escapeHtml(b.protocol)}">
    <div class="appt-head">
      <p class="appt-when">${escapeHtml(capitalize(formatDateLong(b.starts_at)))}, ${formatTime(b.starts_at)}</p>
      <span class="status status-${b.status}">${STATUS_LABEL[b.status] || b.status}</span>
    </div>
    <p>${escapeHtml(services)} · ${formatDuration(b.duration_minutes)} · ${escapeHtml(price)}<br>
      <span class="muted">Com ${escapeHtml(b.professional.name)} · Protocolo ${escapeHtml(b.protocol)}</span></p>
    ${actions && b.token ? `<div class="appt-actions">
      ${b.can_reschedule ? `<button class="button button-quiet" type="button" data-act="resched">Reagendar</button>` : ''}
      ${b.can_cancel ? `<button class="button-back" type="button" data-act="cancel">Cancelar</button>` : ''}
      ${!b.can_cancel && ['pending', 'confirmed'].includes(b.status)
        ? '<span class="muted">O prazo para alterar pelo site já passou. Fale com a gente pelo WhatsApp.</span>' : ''}
    </div>` : ''}
  </article>`;
}

const known = new Map(); // protocolo → agendamento (com token)

function bindActions(container) {
  container.onclick = (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const b = known.get(btn.closest('[data-protocol]').dataset.protocol);
    if (btn.dataset.act === 'cancel') openCancel(b);
    if (btn.dataset.act === 'resched') openResched(b);
  };
}

// ------------------------------------------------------------------ link seguro
async function loadSingle(p, t) {
  try {
    const b = await rpc('get_booking', { p_protocol: p, p_token: t });
    known.set(b.protocol, b);
    $('[data-single]').hidden = false;
    $('[data-single-body]').innerHTML = card(b);
    bindActions($('[data-single-body]'));
    remember(b);
  } catch (err) {
    showAlert(err.message);
  }
}

function remember(b) {
  try {
    const list = JSON.parse(localStorage.getItem('lb.bookings') || '[]').filter((x) => x.p !== b.protocol);
    list.unshift({ p: b.protocol, t: b.token, s: b.starts_at });
    localStorage.setItem('lb.bookings', JSON.stringify(list.slice(0, 10)));
  } catch { /* ignora */ }
}

async function loadDevice() {
  let list = [];
  try { list = JSON.parse(localStorage.getItem('lb.bookings') || '[]'); } catch { list = []; }
  const current = params.get('p');
  list = list.filter((x) => x.p !== current && new Date(x.s) > Date.now() - 864e5);
  if (!list.length) return;
  const results = await Promise.allSettled(list.map((x) => rpc('get_booking', { p_protocol: x.p, p_token: x.t })));
  const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value)
    .filter((b) => ['pending', 'confirmed'].includes(b.status));
  if (!ok.length) return;
  ok.forEach((b) => known.set(b.protocol, b));
  $('[data-device]').hidden = false;
  $('[data-device-list]').innerHTML = ok.map((b) => card(b)).join('');
  bindActions($('[data-device-list]'));
}

// ------------------------------------------------------------------ login por código
const req = $('[data-otp-request]');
const ver = $('[data-otp-verify]');
let otpEmail = '';
req.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = req.email.value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showAlert('Informe um e-mail válido.'); req.email.focus(); return; }
  const btn = req.querySelector('button'); btn.disabled = true;
  try {
    await auth.sendEmailCode(email);
    otpEmail = email;
    req.hidden = true; ver.hidden = false; showAlert('');
    toast(`Enviamos um código para ${email}.`);
    ver.code.focus();
  } catch (err) { showAlert(err.message); } finally { btn.disabled = false; }
});
ver.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = ver.code.value.replace(/\D/g, '');
  if (code.length !== 6) { showAlert('O código tem 6 dígitos.'); return; }
  const btn = ver.querySelector('button[type="submit"]'); btn.disabled = true;
  try {
    await auth.verifyEmailCode(otpEmail, code);
    showAlert('');
    await loadMine();
  } catch (err) { showAlert(err.message); } finally { btn.disabled = false; }
});
$('[data-otp-restart]').addEventListener('click', () => { ver.hidden = true; req.hidden = false; req.email.focus(); });
$('[data-signout]').addEventListener('click', async () => {
  await auth.signOut();
  $('[data-mine]').hidden = true; $('[data-login]').hidden = false; req.hidden = false; ver.hidden = true;
});

async function loadMine() {
  try {
    const me = await rpc('my_appointments');
    me.upcoming.forEach((b) => known.set(b.protocol, b));
    $('[data-login]').hidden = true;
    $('[data-mine]').hidden = false;
    $('[data-mine-email]').textContent = `Entrou como ${me.email}`;
    $('[data-mine-upcoming]').innerHTML = me.upcoming.length
      ? me.upcoming.map((b) => card(b)).join('')
      : '<p>Nenhum horário marcado com este e-mail.</p>';
    bindActions($('[data-mine-upcoming]'));
    $('[data-mine-history]').innerHTML = me.history.length
      ? me.history.map((b) => `<div class="history-row"><span>${escapeHtml(formatDateShort(b.starts_at))} · ${escapeHtml(b.services.map((s) => s.name).join(' + '))}</span>
          <span class="status status-${b.status}">${STATUS_LABEL[b.status]}</span></div>`).join('')
      : '<p class="muted">Ainda sem histórico.</p>';
  } catch (err) {
    if (err.code === 'FORBIDDEN' || err.code === 'NOT_AUTHENTICATED' || err.status === 401) {
      await auth.signOut();
    } else showAlert(err.message);
  }
}

async function refreshAll() {
  const p = params.get('p'); const t = params.get('t');
  if (p && t) await loadSingle(p, t);
  if (getSession()) await loadMine();
  await loadDevice();
}

// ------------------------------------------------------------------ cancelar
const cancelDlg = $('[data-cancel-dialog]');
function openCancel(b) {
  $('[data-cancel-text]').textContent = `${b.services.map((s) => s.name).join(' + ')} em ${formatDateLong(b.starts_at)}, às ${formatTime(b.starts_at)}.`;
  cancelDlg.returnValue = '';
  cancelDlg.showModal();
  cancelDlg.onclose = async () => {
    if (cancelDlg.returnValue !== 'ok') return;
    try {
      const r = await rpc('cancel_booking', { p_protocol: b.protocol, p_token: b.token, p_reason: cancelDlg.querySelector('textarea').value || null });
      known.set(r.protocol, r);
      toast('Agendamento cancelado.');
      await refreshAll();
    } catch (err) { showAlert(err.message); }
  };
}

// ------------------------------------------------------------------ reagendar
const rDlg = $('[data-resched-dialog]');
let rState = null;
async function openResched(b) {
  rState = { b, date: null, slot: null };
  $('[data-resched-info]').textContent = `Atual: ${formatDateLong(b.starts_at)}, às ${formatTime(b.starts_at)} · ${b.services.map((s) => s.name).join(' + ')}`;
  $('[data-resched-days]').innerHTML = '<p class="muted">Carregando dias…</p>';
  $('[data-resched-slots]').innerHTML = '';
  $('[data-resched-ok]').disabled = true;
  rDlg.showModal();
  try {
    const ids = b.services.map((s) => s.id);
    const today = todayISO();
    const months = [today.slice(0, 7) + '-01', addDays(today.slice(0, 7) + '-01', 32).slice(0, 7) + '-01'];
    const cals = await Promise.all(months.map((m) => rpc('get_availability_calendar', { p_service_ids: ids, p_month: m })));
    const days = cals.flatMap((c) => c.days).filter((d) => d.available).slice(0, 21);
    // inclui o dia atual do agendamento (o próprio horário fica livre no reagendamento)
    $('[data-resched-days]').innerHTML = days.length
      ? days.map((d) => `<button type="button" class="slot" role="radio" aria-checked="false" data-day="${d.date}">${escapeHtml(formatDateShort(dateFromISO(d.date)))}</button>`).join('')
      : '<p>Sem dias livres no período. Fale com a gente pelo WhatsApp.</p>';
  } catch (err) {
    $('[data-resched-days]').innerHTML = `<p>${escapeHtml(err.message)}</p>`;
  }
}
$('[data-resched-days]').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-day]');
  if (!btn) return;
  $('[data-resched-days]').querySelectorAll('.slot').forEach((x) => x.setAttribute('aria-checked', String(x === btn)));
  rState.date = btn.dataset.day; rState.slot = null; $('[data-resched-ok]').disabled = true;
  const box = $('[data-resched-slots]');
  box.innerHTML = '<p class="muted">Buscando horários…</p>';
  try {
    const res = await rpc('get_available_slots', {
      p_service_ids: rState.b.services.map((s) => s.id), p_date: rState.date,
      p_protocol: rState.b.protocol, p_token: rState.b.token,
    });
    box.innerHTML = res.slots.length ? `<p class="slot-label">Horários</p><div class="slot-buttons" role="radiogroup" aria-label="Horários">${
      res.slots.filter((s) => s.start !== rState.b.starts_at).map((s) => `<button type="button" class="slot" role="radio" aria-checked="false" data-start="${s.start}">${s.time}</button>`).join('')}</div>`
      : '<p>Sem horários livres nesse dia.</p>';
  } catch (err) { box.innerHTML = `<p>${escapeHtml(err.message)}</p>`; }
});
$('[data-resched-slots]').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-start]');
  if (!btn) return;
  $('[data-resched-slots]').querySelectorAll('.slot').forEach((x) => x.setAttribute('aria-checked', String(x === btn)));
  rState.slot = btn.dataset.start;
  $('[data-resched-ok]').disabled = false;
});
$('[data-resched-close]').addEventListener('click', () => rDlg.close());
$('[data-resched-ok]').addEventListener('click', async () => {
  const btn = $('[data-resched-ok]'); btn.disabled = true; btn.textContent = 'Reagendando…';
  try {
    const r = await rpc('reschedule_booking', { p_protocol: rState.b.protocol, p_token: rState.b.token, p_new_start: rState.slot });
    rDlg.close();
    toast(`Novo horário: ${formatDateLong(r.starts_at)}, às ${formatTime(r.starts_at)}.`);
    await refreshAll();
  } catch (err) {
    showAlert(err.message);
    rDlg.close();
  } finally { btn.textContent = 'Confirmar novo horário'; }
});

if (!isConfigured()) showAlert('A área de agendamentos aparece aqui assim que o sistema for configurado.');
else refreshAll();
