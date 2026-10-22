// Telas do painel.
import { rpc, uploadImage } from '../api.js';
import {
  formatDateLong, formatDateShort, formatDateFull, formatTime, formatDuration, formatMoney, formatPhone, capitalize,
  STATUS_LABEL, todayISO, addDays, isoDate, dateFromISO, formatMonth, toast, maskPhoneInput, imageTag,
} from '../format.js';
import {
  store, e, openSheet, closeSheet, ask, act, catalog, professionals, ts, formData, downloadCsv, WEEKDAYS, can,
} from './core.js';
import { openAppointment, openAppointmentForm } from './appointment.js';

const money = (c) => (c == null ? '<span class="dash">—</span>' : formatMoney(c));
const statusTag = (s) => `<span class="status status-${s}">${STATUS_LABEL[s] || s}</span>`;
const svcNames = (a) => a.services.map((s) => s.name).join(' + ');

// ============================================================== HOJE
export async function today(el) {
  const day = todayISO();
  const [d, cal, pending] = await Promise.all([
    rpc('admin_dashboard'),
    rpc('admin_calendar', { p_from: day, p_to: day }),
    rpc('admin_list_appointments', { p_statuses: ['pending'], p_from: new Date().toISOString(), p_limit: 8 }),
  ]);
  const c = d.counts;
  const max = Math.max(1, ...d.daily.map((x) => x.count));
  el.innerHTML = `
    <div class="view-head">
      <div><h1 class="view-title">${e(capitalize(formatDateLong(dateFromISO(day))))}</h1>
      <p class="view-sub">Olá, ${e((store.me.name || '').split(' ')[0] || 'equipe')}. ${c.today ? `${c.today} atendimento${c.today > 1 ? 's' : ''} hoje.` : 'Nenhum atendimento marcado hoje.'}</p></div>
      <div class="view-actions"><button class="button" type="button" data-new>Novo agendamento</button></div>
    </div>
    ${store.me.has_sample_services ? `<p class="notice">Há serviços de exemplo (preços e durações fictícios). Revise em <a class="link-plain" href="#/servicos">Serviços</a> antes de divulgar a agenda.</p>` : ''}
    <dl class="kpis">
      <div class="kpi"><dt>Hoje</dt><dd>${c.today}</dd></div>
      <div class="kpi"><dt>Esta semana</dt><dd>${c.week}</dd></div>
      <div class="kpi"><dt>Este mês</dt><dd>${c.month}</dd></div>
      <div class="kpi${c.pending ? ' kpi-warn' : ''}"><dt>A confirmar</dt><dd>${c.pending}</dd></div>
      <div class="kpi"><dt>Cancelados no mês</dt><dd>${c.cancelled_month}<small>${c.no_show_month} não compareceram</small></dd></div>
      <div class="kpi"><dt>Clientes</dt><dd>${c.clients}<small>${c.new_clients_month} novas no mês</small></dd></div>
      <div class="kpi"><dt>Receita prevista no mês</dt><dd>${formatMoney(d.revenue.expected_month_cents)}<small>${formatMoney(d.revenue.realized_month_cents)} concluída${d.revenue.unpriced_month ? ` · ${d.revenue.unpriced_month} sem valor` : ''}</small></dd></div>
    </dl>
    <div class="grid-2">
      <section class="block" aria-labelledby="h-dia">
        <h2 class="block-title" id="h-dia">Agenda de hoje <a class="link-plain" href="#/agenda">Abrir agenda</a></h2>
        <div data-daycol></div>
      </section>
      <div class="stack">
        <section class="block" aria-labelledby="h-pend">
          <h2 class="block-title" id="h-pend">Aguardando confirmação <a class="link-plain" href="#/agendamentos?status=pending">Ver todos</a></h2>
          <div class="queue">${pending.rows.length ? pending.rows.map((a) => `
            <div class="queue-item">
              <p><strong>${e(a.client.name)}</strong><br><span class="muted">${e(svcNames(a))} · ${e(formatDateShort(a.starts_at))}, ${formatTime(a.starts_at)}</span></p>
              <div class="queue-actions">
                <button class="button" type="button" data-confirm="${a.id}">Confirmar</button>
                <button class="button-back" type="button" data-open="${a.id}">Ver</button>
              </div>
            </div>`).join('') : '<p class="empty">Nada pendente. Tudo confirmado.</p>'}</div>
        </section>
        <section class="block" aria-labelledby="h-prox">
          <h2 class="block-title" id="h-prox">Próximos atendimentos</h2>
          ${d.next.length ? d.next.map((a) => `
            <button class="card" type="button" data-open="${a.id}">
              <span class="card-row"><strong>${e(capitalize(formatDateShort(a.starts_at)))}, ${formatTime(a.starts_at)}</strong>${statusTag(a.status)}</span>
              <span>${e(a.client.name)} · <span class="muted">${e(svcNames(a))}</span></span>
            </button>`).join('') : '<p class="empty">Sem próximos atendimentos.</p>'}
        </section>
      </div>
    </div>
    <div class="grid-2" style="margin-top:1rem">
      <section class="block" aria-labelledby="h-graf">
        <h2 class="block-title" id="h-graf">Atendimentos por dia <span class="muted" style="font-weight:400;font-size:.8125rem">últimas 2 semanas e próximas 2</span></h2>
        <div class="cbars" style="--n:${d.daily.length}" role="img" aria-label="Gráfico de atendimentos por dia">
          ${d.daily.map((x) => `<div class="cbar${x.date === day ? ' is-today' : x.date < day ? ' is-past' : ''}" style="height:${Math.round((x.count / max) * 100)}%" title="${formatDateShort(dateFromISO(x.date))}: ${x.count}"></div>`).join('')}
        </div>
        <div class="cbars-axis"><span>${formatDateShort(dateFromISO(d.daily[0].date))}</span><span>hoje</span><span>${formatDateShort(dateFromISO(d.daily.at(-1).date))}</span></div>
      </section>
      <section class="block" aria-labelledby="h-top">
        <h2 class="block-title" id="h-top">Serviços mais procurados <span class="muted" style="font-weight:400;font-size:.8125rem">90 dias</span></h2>
        ${hbars(d.top_services.map((s) => [s.name, s.count]))}
      </section>
    </div>`;
  renderDayColumn(el.querySelector('[data-daycol]'), day, cal, null);
  el.querySelector('[data-new]').onclick = () => openAppointmentForm({ date: day });
  el.onclick = async (ev) => {
    const open = ev.target.closest('[data-open]');
    if (open) openAppointment(open.dataset.open);
    const conf = ev.target.closest('[data-confirm]');
    if (conf) {
      await act(conf, () => rpc('admin_set_appointment_status', { p_id: conf.dataset.confirm, p_status: 'confirmed' }), 'Agendamento confirmado.').catch(() => null);
      today(el);
    }
  };
}

function hbars(rows) {
  if (!rows.length) return '<p class="empty">Ainda sem dados suficientes.</p>';
  const max = Math.max(...rows.map((r) => r[1]), 1);
  return `<div class="hbars">${rows.map(([label, v]) => `<div class="hbar"><span>${e(label)}</span>
    <span class="hbar-track"><span class="hbar-fill" style="display:block;width:${(v / max) * 100}%"></span></span><span class="hbar-value">${v}</span></div>`).join('')}</div>`;
}

// Coluna de um dia (usada em Hoje, Agenda-dia e Agenda-semana).
const HOUR_PX = 56;
function dayRange(date, cal, professionalId) {
  const dayStart = new Date(ts(date, '00:00'));
  const hourOf = (d) => (d - dayStart) / 36e5;
  let from = 8; let to = 19;
  cal.hours.filter((h) => h.date === date && (!professionalId || h.professional_id === professionalId))
    .forEach((h) => h.intervals.forEach((i) => { from = Math.min(from, Math.floor(hourOf(new Date(i.start)))); to = Math.max(to, Math.ceil(hourOf(new Date(i.end)))); }));
  cal.appointments.filter((a) => isoDate(new Date(a.starts_at)) === date && a.status !== 'cancelled' && (!professionalId || a.professional.id === professionalId))
    .forEach((a) => { from = Math.min(from, Math.floor(hourOf(new Date(a.starts_at)))); to = Math.max(to, Math.ceil(hourOf(new Date(a.ends_at)))); });
  from = Math.max(0, from); to = Math.min(24, Math.max(to, from + 4));
  return [from, to];
}

function renderDayColumn(box, date, cal, professionalId, { showHours = true, range = null } = {}) {
  const hours = cal.hours.filter((h) => h.date === date && (!professionalId || h.professional_id === professionalId));
  const intervals = hours.flatMap((h) => h.intervals.map((i) => [new Date(i.start), new Date(i.end)]));
  const dayStart = new Date(ts(date, '00:00'));
  const hourOf = (d) => (d - dayStart) / 36e5;
  const appts = cal.appointments.filter((a) => isoDate(new Date(a.starts_at)) === date && a.status !== 'cancelled'
    && (!professionalId || a.professional.id === professionalId));
  const blocks = cal.blocks.filter((b) => new Date(b.starts_at) < new Date(ts(addDays(date, 1), '00:00')) && new Date(b.ends_at) > dayStart
    && (!professionalId || !b.professional_id || b.professional_id === professionalId));
  const [from, to] = range || dayRange(date, cal, professionalId);
  const y = (h) => (h - from) * HOUR_PX;
  const pros = new Map(cal.professionals.map((p) => [p.id, p]));
  const lanes = professionalId ? [professionalId] : [...new Set(appts.map((a) => a.professional.id))];
  const laneOf = (pid) => Math.max(0, lanes.indexOf(pid));
  const laneW = 100 / Math.max(1, lanes.length);
  const closed = [];
  let cursor = from;
  intervals.sort((a, b) => a[0] - b[0]).forEach(([s, f]) => { if (hourOf(s) > cursor) closed.push([cursor, hourOf(s)]); cursor = Math.max(cursor, hourOf(f)); });
  if (cursor < to) closed.push([cursor, to]);
  const nowH = hourOf(new Date());
  box.innerHTML = `<div class="day-col" style="--hour:${HOUR_PX}px">
    ${showHours ? `<div class="day-hours">${Array.from({ length: to - from }, (_, i) => `<span>${String(from + i).padStart(2, '0')}h</span>`).join('')}</div>` : '<div></div>'}
    <div class="day-track" style="height:${(to - from) * HOUR_PX}px">
      ${closed.map(([s, f]) => `<div class="day-closed" style="top:${y(s)}px;height:${(f - s) * HOUR_PX}px" title="Fora do horário"></div>`).join('')}
      ${blocks.map((b) => { const s = Math.max(from, hourOf(new Date(b.starts_at))); const f = Math.min(to, hourOf(new Date(b.ends_at)));
        return `<a class="day-block is-block" href="#/bloqueios" style="top:${y(s)}px;height:${Math.max(18, (f - s) * HOUR_PX - 2)}px"><strong>${e(blockLabel(b.kind))}</strong><span>${e(b.reason || '')}</span></a>`; }).join('')}
      ${appts.map((a) => { const s = hourOf(new Date(a.starts_at)); const f = hourOf(new Date(a.ends_at)); const p = pros.get(a.professional.id);
        return `<button type="button" class="day-block st-${a.status}" data-open="${a.id}" style="top:${y(s)}px;height:${Math.max(22, (f - s) * HOUR_PX - 2)}px;left:calc(${laneOf(a.professional.id) * laneW}% + 4px);right:auto;width:calc(${laneW}% - 8px);${p ? `border-left-color:${p.color}` : ''}">
          <strong>${formatTime(a.starts_at)} ${e(a.client.name)}</strong><span>${e(svcNames(a))}${lanes.length > 1 ? ` · ${e(a.professional.name)}` : ''}${a.status === 'pending' ? ' · a confirmar' : ''}</span></button>`; }).join('')}
      ${date === todayISO() && nowH > from && nowH < to ? `<div class="now-line" style="top:${y(nowH)}px" aria-label="Agora"></div>` : ''}
    </div></div>`;
  box.onclick = (ev) => { const b = ev.target.closest('[data-open]'); if (b) openAppointment(b.dataset.open); };
  if (showHours && !appts.length && !blocks.length) box.insertAdjacentHTML('afterbegin', `<p class="muted" style="margin-bottom:.5rem">${intervals.length ? 'Nenhum atendimento marcado.' : 'Studio fechado neste dia.'}</p>`);
}
const blockLabel = (k) => ({ block: 'Bloqueado', vacation: 'Férias', day_off: 'Folga', break: 'Pausa' }[k] || 'Bloqueado');

// ============================================================== AGENDA (dia / semana / mês)
export async function agenda(el, q) {
  const pros = await professionals();
  let mode = q.get('modo') || (matchMedia('(max-width: 63.99em)').matches ? 'dia' : 'semana');
  let date = q.get('data') || todayISO();
  let pro = q.get('prof') || '';
  el.innerHTML = `
    <div class="view-head">
      <div><h1 class="view-title" data-agenda-title></h1><p class="view-sub" data-agenda-sub></p></div>
      <div class="view-actions">
        <div class="cal-switch" role="group" aria-label="Visualização">
          ${['dia', 'semana', 'mes'].map((m) => `<button type="button" data-mode="${m}">${{ dia: 'Dia', semana: 'Semana', mes: 'Mês' }[m]}</button>`).join('')}
        </div>
        <button class="button button-quiet" type="button" data-nav="-1" aria-label="Anterior">‹</button>
        <button class="button button-quiet" type="button" data-nav="0">Hoje</button>
        <button class="button button-quiet" type="button" data-nav="1" aria-label="Próximo">›</button>
        <label class="sr-only" for="ag-pro">Profissional</label>
        <select class="field" id="ag-pro" data-pro style="width:auto"><option value="">Todas as profissionais</option>
          ${pros.filter((p) => p.active).map((p) => `<option value="${p.id}">${e(p.name)}</option>`).join('')}</select>
        <button class="button" type="button" data-new>Novo</button>
      </div>
    </div>
    <div data-agenda></div>`;
  el.querySelector('[data-pro]').value = pro;
  const box = el.querySelector('[data-agenda]');

  async function draw() {
    el.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    history.replaceState(null, '', `#/agenda?modo=${mode}&data=${date}${pro ? `&prof=${pro}` : ''}`);
    let from = date; let to = date;
    if (mode === 'semana') { const dow = new Date(`${date}T12:00:00Z`).getUTCDay(); from = addDays(date, -((dow + 6) % 7)); to = addDays(from, 6); }
    if (mode === 'mes') {
      const first = `${date.slice(0, 7)}-01`; const dow = new Date(`${first}T12:00:00Z`).getUTCDay();
      from = addDays(first, -dow); to = addDays(from, 41);
    }
    box.innerHTML = '<p class="empty">Carregando…</p>';
    const cal = await rpc('admin_calendar', { p_from: from, p_to: to, p_professional_id: pro || null });
    const title = el.querySelector('[data-agenda-title]');
    const sub = el.querySelector('[data-agenda-sub]');
    const active = cal.appointments.filter((a) => a.status !== 'cancelled');
    if (mode === 'dia') {
      title.textContent = capitalize(formatDateLong(dateFromISO(date)));
      sub.textContent = `${active.length} atendimento${active.length === 1 ? '' : 's'}`;
      box.innerHTML = '<div class="block" data-col></div>';
      renderDayColumn(box.querySelector('[data-col]'), date, cal, pro || null);
    } else if (mode === 'semana') {
      title.textContent = `Semana de ${formatDateShort(dateFromISO(from))} a ${formatDateShort(dateFromISO(to))}`;
      sub.textContent = `${active.length} atendimento${active.length === 1 ? '' : 's'}`;
      const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
      box.innerHTML = `<div class="block"><div class="week" style="--days:7">
        <div></div>${days.map((d) => `<div class="week-head${d === todayISO() ? ' is-today' : ''}"><button type="button" data-day="${d}">${e(capitalize(formatDateShort(dateFromISO(d))))}</button></div>`).join('')}
        ${days.map((d, i) => `<div data-wcol="${d}" style="grid-row:2;grid-column:${i + 2}"></div>`).join('')}
        <div data-whours style="grid-row:2;grid-column:1"></div></div></div>`;
      // escala de horas comum a todos os dias da semana
      const ranges = days.map((d) => dayRange(d, cal, pro || null));
      const range = [Math.min(...ranges.map((r) => r[0])), Math.max(...ranges.map((r) => r[1]))];
      days.forEach((d) => renderDayColumn(box.querySelector(`[data-wcol="${d}"]`), d, cal, pro || null, { showHours: false, range }));
      box.querySelector('[data-whours]').innerHTML = `<div class="day-hours" style="--hour:${HOUR_PX}px">${Array.from({ length: range[1] - range[0] }, (_, i) => `<span>${String(range[0] + i).padStart(2, '0')}h</span>`).join('')}</div>`;
    } else {
      title.textContent = capitalize(formatMonth(dateFromISO(date)));
      sub.textContent = `${active.filter((a) => a.starts_at.slice(0, 7) === date.slice(0, 7) || isoDate(new Date(a.starts_at)).slice(0, 7) === date.slice(0, 7)).length} atendimentos no mês`;
      const days = Array.from({ length: 42 }, (_, i) => addDays(from, i));
      const byDay = new Map();
      active.forEach((a) => { const k = isoDate(new Date(a.starts_at)); (byDay.get(k) || byDay.set(k, []).get(k)).push(a); });
      const openDays = new Set(cal.hours.filter((h) => h.intervals.length).map((h) => h.date));
      box.innerHTML = `<div class="month">${['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((w) => `<div class="month-head">${w}</div>`).join('')}
        ${days.map((d) => { const list = byDay.get(d) || [];
          return `<button type="button" class="month-cell${d.slice(0, 7) !== date.slice(0, 7) ? ' is-out' : ''}${d === todayISO() ? ' is-today' : ''}${openDays.has(d) ? '' : ' is-closed'}" data-day="${d}" aria-label="${e(formatDateLong(dateFromISO(d)))}: ${list.length} atendimentos">
            <span class="month-day">${Number(d.slice(8))}</span>
            ${list.slice(0, 3).map((a) => `<span class="month-item st-${a.status}">${formatTime(a.starts_at)} ${e(a.client.name.split(' ')[0])}</span>`).join('')}
            ${list.length > 3 ? `<span class="month-more">+${list.length - 3}</span>` : ''}</button>`; }).join('')}</div>`;
    }
  }
  el.onclick = (ev) => {
    const m = ev.target.closest('[data-mode]'); if (m) { mode = m.dataset.mode; draw(); }
    const n = ev.target.closest('[data-nav]');
    if (n) {
      const k = Number(n.dataset.nav);
      if (!k) date = todayISO();
      else if (mode === 'dia') date = addDays(date, k);
      else if (mode === 'semana') date = addDays(date, 7 * k);
      else { const d = new Date(`${date.slice(0, 7)}-15T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + k); date = d.toISOString().slice(0, 10); }
      draw();
    }
    const d = ev.target.closest('[data-day]'); if (d) { date = d.dataset.day; mode = 'dia'; draw(); }
    if (ev.target.closest('[data-new]')) openAppointmentForm({ date, professionalId: pro || null });
  };
  el.querySelector('[data-pro]').addEventListener('change', (ev) => { pro = ev.target.value; draw(); });
  await draw();
}

// ============================================================== AGENDAMENTOS (tabela)
export async function appointments(el, q) {
  const pros = await professionals();
  const st = { from: q.get('de') || addDays(todayISO(), -30), to: q.get('ate') || addDays(todayISO(), 60), status: q.get('status') || '',
    pro: '', search: '', order: 'starts_at_asc', page: 0 };
  const PAGE = 25;
  el.innerHTML = `
    <div class="view-head"><div><h1 class="view-title">Agendamentos</h1><p class="view-sub" data-total></p></div>
      <div class="view-actions"><button class="button" type="button" data-new>Novo agendamento</button></div></div>
    <form class="toolbar" data-filters>
      <div class="form-row grow"><label for="f-q">Buscar</label><input class="field" id="f-q" type="search" name="search" placeholder="Cliente, telefone, protocolo ou serviço"></div>
      <div class="form-row"><label for="f-de">De</label><input class="field" id="f-de" type="date" name="from" value="${st.from}"></div>
      <div class="form-row"><label for="f-ate">Até</label><input class="field" id="f-ate" type="date" name="to" value="${st.to}"></div>
      <div class="form-row"><label for="f-st">Status</label><select class="field" id="f-st" name="status"><option value="">Todos</option>
        ${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${st.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="form-row"><label for="f-pro">Profissional</label><select class="field" id="f-pro" name="pro"><option value="">Todas</option>
        ${pros.map((p) => `<option value="${p.id}">${e(p.name)}</option>`).join('')}</select></div>
      <div class="form-row"><label for="f-ord">Ordenar</label><select class="field" id="f-ord" name="order">
        <option value="starts_at_asc">Data (mais antigas)</option><option value="starts_at_desc">Data (mais recentes)</option>
        <option value="client">Cliente (A–Z)</option><option value="price_desc">Maior valor</option></select></div>
    </form>
    <div data-results></div>`;
  const form = el.querySelector('[data-filters]');
  const res = el.querySelector('[data-results]');
  async function load() {
    res.innerHTML = '<p class="empty">Carregando…</p>';
    const r = await rpc('admin_list_appointments', {
      p_from: st.from ? ts(st.from, '00:00') : null, p_to: st.to ? ts(addDays(st.to, 1), '00:00') : null,
      p_statuses: st.status ? [st.status] : null, p_professional_id: st.pro || null, p_search: st.search || null,
      p_order: st.order, p_limit: PAGE, p_offset: st.page * PAGE,
    });
    el.querySelector('[data-total]').textContent = `${r.total} no filtro`;
    if (!r.rows.length) { res.innerHTML = '<p class="empty">Nenhum agendamento com esses filtros.</p>'; return; }
    res.innerHTML = `
      <div class="table-wrap responsive"><table class="table">
        <thead><tr><th>Data</th><th>Horário</th><th>Cliente</th><th>Telefone</th><th>Serviço</th><th>Profissional</th><th class="num">Valor</th><th>Status</th></tr></thead>
        <tbody>${r.rows.map((a) => `<tr data-open="${a.id}" tabindex="0">
          <td>${e(formatDateShort(a.starts_at))}</td><td class="num">${formatTime(a.starts_at)}</td>
          <td>${e(a.client.name)}<br><span class="muted">${e(a.protocol)}</span></td><td>${e(formatPhone(a.client.phone))}</td>
          <td>${e(svcNames(a))}</td><td>${e(a.professional.name)}</td><td class="num">${money(a.total_price_cents)}</td><td>${statusTag(a.status)}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="cards">${r.rows.map((a) => `<button class="card" type="button" data-open="${a.id}">
        <span class="card-row"><strong>${e(capitalize(formatDateShort(a.starts_at)))}, ${formatTime(a.starts_at)}</strong>${statusTag(a.status)}</span>
        <span>${e(a.client.name)}</span><span class="muted">${e(svcNames(a))} · ${e(a.professional.name)}</span></button>`).join('')}</div>
      <div class="pager"><span>${st.page * PAGE + 1}–${Math.min(r.total, (st.page + 1) * PAGE)} de ${r.total}</span>
        <div><button class="button button-quiet" type="button" data-page="-1" ${st.page ? '' : 'disabled'}>Anteriores</button>
        <button class="button button-quiet" type="button" data-page="1" ${(st.page + 1) * PAGE < r.total ? '' : 'disabled'}>Próximos</button></div></div>`;
  }
  let t;
  form.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => { const f = formData(form); Object.assign(st, { search: f.search.trim(), from: f.from, to: f.to, status: f.status, pro: f.pro, order: f.order, page: 0 }); load(); }, 250);
  });
  form.addEventListener('submit', (ev) => ev.preventDefault());
  res.addEventListener('click', (ev) => {
    const o = ev.target.closest('[data-open]'); if (o) openAppointment(o.dataset.open);
    const p = ev.target.closest('[data-page]'); if (p) { st.page += Number(p.dataset.page); load(); }
  });
  res.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.matches('tr[data-open]')) openAppointment(ev.target.dataset.open); });
  el.querySelector('[data-new]').onclick = () => openAppointmentForm({});
  await load();
}

// ============================================================== CLIENTES
export async function clients(el) {
  const st = { search: '', filter: '', page: 0 };
  const PAGE = 30;
  el.innerHTML = `
    <div class="view-head"><div><h1 class="view-title">Clientes</h1><p class="view-sub" data-total></p></div>
      <div class="view-actions"><button class="button" type="button" data-new>Nova cliente</button></div></div>
    <form class="toolbar" data-filters>
      <div class="form-row grow"><label for="c-q">Buscar</label><input class="field" id="c-q" type="search" name="search" placeholder="Nome, WhatsApp ou e-mail"></div>
      <div class="form-row"><label for="c-f">Mostrar</label><select class="field" id="c-f" name="filter">
        <option value="">Todas</option><option value="upcoming">Com horário marcado</option><option value="recurring">Recorrentes (2+ visitas)</option><option value="inactive">Sem visita há 90 dias</option></select></div>
    </form>
    <div data-results></div>`;
  const res = el.querySelector('[data-results]');
  async function load() {
    const r = await rpc('admin_list_clients', { p_search: st.search || null, p_filter: st.filter || null, p_limit: PAGE, p_offset: st.page * PAGE });
    el.querySelector('[data-total]').textContent = `${r.total} cliente${r.total === 1 ? '' : 's'}`;
    if (!r.rows.length) { res.innerHTML = '<p class="empty">Nenhuma cliente encontrada.</p>'; return; }
    res.innerHTML = `<div class="table-wrap responsive"><table class="table"><thead><tr><th>Nome</th><th>WhatsApp</th><th>E-mail</th><th class="num">Agendamentos</th><th>Última visita</th><th>Próximo horário</th></tr></thead>
      <tbody>${r.rows.map((c) => `<tr data-client="${c.id}" data-open tabindex="0"><td>${e(c.name)}</td><td>${e(formatPhone(c.phone))}</td><td>${c.email ? e(c.email) : '<span class="dash">—</span>'}</td>
        <td class="num">${c.visits}</td><td>${c.last_visit ? e(formatDateFull(c.last_visit)) : '<span class="dash">—</span>'}</td><td>${c.next_visit ? e(formatDateShort(c.next_visit)) + ', ' + formatTime(c.next_visit) : '<span class="dash">—</span>'}</td></tr>`).join('')}</tbody></table></div>
      <div class="cards">${r.rows.map((c) => `<button class="card" type="button" data-client="${c.id}"><span class="card-row"><strong>${e(c.name)}</strong><span class="muted">${c.visits} agend.</span></span><span class="muted">${e(formatPhone(c.phone))}</span></button>`).join('')}</div>
      <div class="pager"><span>${st.page * PAGE + 1}–${Math.min(r.total, (st.page + 1) * PAGE)} de ${r.total}</span><div>
        <button class="button button-quiet" type="button" data-page="-1" ${st.page ? '' : 'disabled'}>Anteriores</button>
        <button class="button button-quiet" type="button" data-page="1" ${(st.page + 1) * PAGE < r.total ? '' : 'disabled'}>Próximos</button></div></div>`;
  }
  let t;
  el.querySelector('[data-filters]').addEventListener('input', (ev) => {
    clearTimeout(t);
    t = setTimeout(() => { const f = formData(ev.currentTarget || el.querySelector('[data-filters]')); st.search = f.search.trim(); st.filter = f.filter; st.page = 0; load(); }, 250);
  });
  el.querySelector('[data-filters]').addEventListener('submit', (ev) => ev.preventDefault());
  res.addEventListener('click', (ev) => {
    const c = ev.target.closest('[data-client]'); if (c) openClient(c.dataset.client, load);
    const p = ev.target.closest('[data-page]'); if (p) { st.page += Number(p.dataset.page); load(); }
  });
  res.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.dataset.client) openClient(ev.target.dataset.client, load); });
  el.querySelector('[data-new]').onclick = () => clientForm(null, load);
  await load();
}

export async function openClient(id, refresh = () => {}) {
  let c;
  try { c = await rpc('admin_get_client', { p_id: id }); } catch (err) { toast(err.message); return; }
  const done = c.appointments.filter((a) => a.status === 'completed').length;
  const body = openSheet(c.name, `
    <dl class="dl">
      <dt>WhatsApp</dt><dd><a class="link-plain" href="https://wa.me/${c.phone}" target="_blank" rel="noopener">${e(formatPhone(c.phone))}</a></dd>
      <dt>E-mail</dt><dd>${c.email ? e(c.email) : '<span class="dash">—</span>'}</dd>
      <dt>Cliente desde</dt><dd>${e(formatDateFull(c.created_at))}</dd>
      <dt>Atendimentos</dt><dd>${c.appointments.length} agendados · ${done} concluídos</dd>
      ${c.admin_notes ? `<dt>Observações</dt><dd>${e(c.admin_notes)}</dd>` : ''}
    </dl>
    <div class="action-row"><button class="button button-quiet" type="button" data-edit>Editar dados</button>
      <button class="button" type="button" data-book>Novo agendamento</button></div>
    <div><p class="block-title">Histórico</p>
      ${c.appointments.length ? c.appointments.map((a) => `<button class="card" type="button" data-open="${a.id}">
        <span class="card-row"><strong>${e(formatDateFull(a.starts_at))}, ${formatTime(a.starts_at)}</strong>${statusTag(a.status)}</span>
        <span class="muted">${e(svcNames(a))} · ${e(a.professional.name)} · ${a.total_price_cents == null ? 'sem valor' : formatMoney(a.total_price_cents)}</span></button>`).join('') : '<p class="empty">Sem agendamentos.</p>'}</div>`);
  body.querySelector('[data-edit]').onclick = () => clientForm(c, refresh);
  body.querySelector('[data-book]').onclick = () => openAppointmentForm({}).then(() => {
    const s = document.querySelector('[data-client-search]');
    if (s) { s.value = c.name; s.dispatchEvent(new Event('input')); }
  });
  body.onclick = (ev) => { const o = ev.target.closest('[data-open]'); if (o) openAppointment(o.dataset.open); };
}

function clientForm(c, refresh) {
  const body = openSheet(c ? `Editar ${c.name}` : 'Nova cliente', `
    <form class="form" novalidate>
      <div class="form-row"><label for="cf-n">Nome completo</label><input class="field" id="cf-n" name="name" value="${e(c?.name || '')}" required></div>
      <div class="form-row"><label for="cf-p">WhatsApp</label><input class="field" id="cf-p" name="phone" type="tel" value="${e(c ? formatPhone(c.phone) : '')}" required></div>
      <div class="form-row"><label for="cf-e">E-mail</label><input class="field" id="cf-e" name="email" type="email" value="${e(c?.email || '')}"></div>
      <div class="form-row"><label for="cf-o">Observações da equipe</label><textarea class="field" id="cf-o" name="notes" rows="3" maxlength="1000">${e(c?.admin_notes || '')}</textarea>
        <p class="field-hint">Registre só o necessário para o atendimento (ex.: preferências). Evite dados de saúde além de alergias relevantes.</p></div>
      <p class="field-error" role="alert" data-err></p>
      <div class="form-actions"><button class="button" type="submit">Salvar</button><button class="button-back" type="button" data-back>Voltar</button></div>
    </form>`);
  const form = body.querySelector('form');
  form.phone.addEventListener('input', () => { form.phone.value = maskPhoneInput(form.phone.value); });
  body.querySelector('[data-back]').onclick = () => (c ? openClient(c.id, refresh) : closeSheet());
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const r = await act(ev.submitter, () => rpc('admin_save_client', { p_id: c?.id || null, p_name: form.name.value, p_phone: form.phone.value, p_email: form.email.value, p_admin_notes: form.notes.value }), 'Cliente salva.');
      refresh(); openClient(r.id, refresh);
    } catch (err) { body.querySelector('[data-err]').textContent = err.message; }
  });
}

// ============================================================== SERVIÇOS
export async function services(el) {
  const [cat, pros] = await Promise.all([catalog(true), professionals(true)]);
  const canEdit = can('owner', 'manager');
  const groups = cat.categories.map((c) => ({ c, list: cat.services.filter((s) => s.category_id === c.id) }))
    .concat([{ c: { name: 'Sem categoria' }, list: cat.services.filter((s) => !s.category_id) }]).filter((g) => g.list.length || g.c.id);
  el.innerHTML = `
    <div class="view-head"><div><h1 class="view-title">Serviços</h1><p class="view-sub">Alterações aparecem na hora no site e na agenda online.</p></div>
      ${canEdit ? '<div class="view-actions"><button class="button button-quiet" type="button" data-cat-new>Nova categoria</button><button class="button" type="button" data-new>Novo serviço</button></div>' : ''}</div>
    ${cat.services.some((s) => s.is_sample) ? '<p class="notice">Serviços marcados como <strong>exemplo</strong> têm nome, duração e preço fictícios. Ao salvar um serviço, a marca de exemplo sai.</p>' : ''}
    ${groups.map(({ c, list }) => `<section class="block">
      <h2 class="block-title">${e(c.name)} ${c.id && canEdit ? `<button class="link-plain" type="button" data-cat-edit="${c.id}">Editar categoria</button>` : ''}</h2>
      ${list.length ? list.map((s) => `<div class="svc-admin${s.active ? '' : ' inactive'}">
        ${s.image_path ? imageTag(s.image_path, '', { sizes: '64px', widths: [480] }) : '<span class="ph"></span>'}
        <div><strong>${e(s.name)}</strong>${s.is_sample ? ' <span class="status status-pending">exemplo</span>' : ''}${s.active ? '' : ' <span class="status">inativo</span>'}
          <br><span class="muted">${formatDuration(s.duration_minutes)} · ${s.price_cents == null ? 'sob consulta' : (s.price_is_starting ? 'a partir de ' : '') + formatMoney(s.price_cents)}
          · ${s.professional_ids.length ? s.professional_ids.map((id) => pros.find((p) => p.id === id)?.name).filter(Boolean).join(', ') : 'sem profissional vinculada'}
          · ${s.bookable_online ? 'agenda online' : 'só pela equipe'}</span></div>
        ${canEdit ? `<button class="button button-quiet" type="button" data-edit="${s.id}">Editar</button>` : ''}</div>`).join('') : '<p class="empty">Nenhum serviço nesta categoria.</p>'}
    </section>`).join('')}`;
  el.onclick = (ev) => {
    const ed = ev.target.closest('[data-edit]'); if (ed) serviceForm(cat.services.find((s) => s.id === ed.dataset.edit), cat, pros, () => services(el));
    if (ev.target.closest('[data-new]')) serviceForm(null, cat, pros, () => services(el));
    const ce = ev.target.closest('[data-cat-edit]'); if (ce) categoryForm(cat.categories.find((c) => c.id === ce.dataset.catEdit), () => services(el));
    if (ev.target.closest('[data-cat-new]')) categoryForm(null, () => services(el));
  };
}

function serviceForm(s, cat, pros, refresh) {
  const body = openSheet(s ? `Editar ${s.name}` : 'Novo serviço', `
    <form class="form" novalidate>
      <div class="form-row"><label for="s-n">Nome</label><input class="field" id="s-n" name="name" value="${e(s?.name || '')}" required maxlength="80"></div>
      <div class="form-grid">
        <div class="form-row"><label for="s-c">Categoria</label><select class="field" id="s-c" name="category_id"><option value="">Sem categoria</option>
          ${cat.categories.map((c) => `<option value="${c.id}" ${s?.category_id === c.id ? 'selected' : ''}>${e(c.name)}</option>`).join('')}</select></div>
        <div class="form-row"><label for="s-o">Ordem</label><input class="field" id="s-o" name="sort_order" type="number" value="${s?.sort_order ?? 0}"></div>
        <div class="form-row"><label for="s-d">Duração (minutos)</label><input class="field" id="s-d" name="duration_minutes" type="number" min="5" max="600" step="5" value="${s?.duration_minutes || 60}" required></div>
        <div class="form-row"><label for="s-b">Intervalo depois (min)</label><input class="field" id="s-b" name="buffer_after_minutes" type="number" min="0" max="120" step="5" value="${s?.buffer_after_minutes ?? ''}" placeholder="padrão do studio"></div>
        <div class="form-row"><label for="s-p">Preço (R$)</label><input class="field" id="s-p" name="price" inputmode="decimal" value="${s?.price_cents != null ? (s.price_cents / 100).toFixed(2).replace('.', ',') : ''}" placeholder="vazio = sob consulta"></div>
        <div class="form-row checks" style="align-content:end"><label><input type="checkbox" name="price_is_starting" ${s?.price_is_starting ? 'checked' : ''}> Preço "a partir de"</label></div>
      </div>
      <div class="form-row"><label for="s-sum">Resumo (uma linha)</label><input class="field" id="s-sum" name="summary" maxlength="140" value="${e(s?.summary || '')}"></div>
      <div class="form-row"><label for="s-desc">Descrição</label><textarea class="field" id="s-desc" name="description" rows="4">${e(s?.description || '')}</textarea></div>
      <div class="form-row"><label for="s-img">Imagem</label>
        <div data-img-preview>${s?.image_path ? imageTag(s.image_path, '', { sizes: '160px', widths: [480] }) : ''}</div>
        <input class="field" id="s-img" type="file" accept="image/jpeg,image/png,image/webp,image/avif" data-upload>
        <input type="hidden" name="image_path" value="${e(s?.image_path || '')}">
        <label for="s-alt">Descrição da imagem (acessibilidade)</label><input class="field" id="s-alt" name="image_alt" value="${e(s?.image_alt || '')}"></div>
      <fieldset class="form-row" style="border:0;padding:0;margin:0"><legend style="font-size:.875rem;margin-bottom:.4rem">Profissionais que fazem este serviço</legend>
        <div class="checks">${pros.map((p) => `<label><input type="checkbox" name="professional_ids" value="${p.id}" data-multi ${!s || s.professional_ids.includes(p.id) ? 'checked' : ''}> ${e(p.name)}${p.active ? '' : ' (inativa)'}</label>`).join('')}</div></fieldset>
      <div class="checks">
        <label><input type="checkbox" name="active" ${!s || s.active ? 'checked' : ''}> Ativo (aparece no site)</label>
        <label><input type="checkbox" name="bookable_online" ${!s || s.bookable_online ? 'checked' : ''}> Pode ser agendado online</label>
        <label><input type="checkbox" name="combinable" ${!s || s.combinable ? 'checked' : ''}> Pode ser combinado com outros serviços no mesmo horário</label>
      </div>
      <p class="field-error" role="alert" data-err></p>
      <div class="form-actions"><button class="button" type="submit">Salvar serviço</button>
        ${s ? `<button class="button-back" type="button" data-del>${s.appointment_count ? 'Desativar' : 'Excluir'}</button>` : ''}</div>
    </form>`);
  const form = body.querySelector('form');
  body.querySelector('[data-upload]').addEventListener('change', async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    try {
      const url = await uploadImage(f, 'services');
      form.image_path.value = url;
      body.querySelector('[data-img-preview]').innerHTML = `<img src="${e(url)}" alt="" style="width:160px;height:160px;object-fit:cover">`;
      toast('Imagem enviada. Salve o serviço para aplicar.');
    } catch (err) { toast(err.message); }
  });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = formData(form);
    const price = f.price.trim() ? Math.round(Number(f.price.replace(/\./g, '').replace(',', '.')) * 100) : null;
    if (f.price.trim() && !Number.isFinite(price)) { body.querySelector('[data-err]').textContent = 'Preço inválido. Use, por exemplo, 85,00.'; return; }
    const p = { ...f, id: s?.id, price_cents: price, duration_minutes: Number(f.duration_minutes), sort_order: Number(f.sort_order || 0),
      buffer_after_minutes: f.buffer_after_minutes === '' ? null : Number(f.buffer_after_minutes), professional_ids: f.professional_ids || [] };
    delete p.price;
    try { await act(ev.submitter, () => rpc('admin_save_service', { p }), 'Serviço salvo.'); store.catalog = null; closeSheet(); refresh(); }
    catch (err) { body.querySelector('[data-err]').textContent = err.message; }
  });
  body.querySelector('[data-del]')?.addEventListener('click', async (ev) => {
    if (s.appointment_count) {
      await act(ev.target, () => rpc('admin_save_service', { p: { ...s, active: false } }), 'Serviço desativado.').catch(() => {});
    } else {
      const ok = await ask('Excluir serviço?', `“${s.name}” será removido. Essa ação não pode ser desfeita.`, { ok: 'Excluir', danger: true });
      if (!ok) { serviceForm(s, cat, pros, refresh); return; }
      await act(null, () => rpc('admin_delete_service', { p_id: s.id }), 'Serviço excluído.').catch(() => {});
    }
    store.catalog = null; closeSheet(); refresh();
  });
}

function categoryForm(c, refresh) {
  const body = openSheet(c ? 'Editar categoria' : 'Nova categoria', `
    <form class="form" novalidate>
      <div class="form-row"><label for="k-n">Nome</label><input class="field" id="k-n" name="name" value="${e(c?.name || '')}" required></div>
      <div class="form-row"><label for="k-d">Descrição</label><input class="field" id="k-d" name="description" value="${e(c?.description || '')}"></div>
      <div class="form-row"><label for="k-o">Ordem</label><input class="field" id="k-o" name="sort_order" type="number" value="${c?.sort_order ?? 0}"></div>
      <p class="field-error" role="alert" data-err></p>
      <div class="form-actions"><button class="button" type="submit">Salvar</button>${c ? '<button class="button-back" type="button" data-del>Excluir categoria</button>' : ''}</div>
    </form>`);
  const form = body.querySelector('form');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try { await act(ev.submitter, () => rpc('admin_save_category', { p_id: c?.id || null, p_name: form.name.value, p_description: form.description.value || null, p_sort_order: Number(form.sort_order.value || 0) }), 'Categoria salva.'); closeSheet(); refresh(); }
    catch (err) { body.querySelector('[data-err]').textContent = err.message; }
  });
  body.querySelector('[data-del]')?.addEventListener('click', async () => {
    const ok = await ask('Excluir categoria?', 'Os serviços dela ficam “sem categoria”.', { ok: 'Excluir', danger: true });
    if (!ok) { categoryForm(c, refresh); return; }
    await act(null, () => rpc('admin_delete_category', { p_id: c.id }), 'Categoria excluída.').catch(() => {});
    closeSheet(); refresh();
  });
}

// ============================================================== PROFISSIONAIS
export async function pros(el) {
  const [list, cat] = await Promise.all([professionals(true), catalog(true)]);
  const canEdit = can('owner', 'manager');
  el.innerHTML = `
    <div class="view-head"><div><h1 class="view-title">Profissionais</h1><p class="view-sub">Quem atende, quais serviços faz e em que horários.</p></div>
      ${canEdit ? '<div class="view-actions"><button class="button" type="button" data-new>Nova profissional</button></div>' : ''}</div>
    <section class="block">${list.map((p) => `<div class="svc-admin${p.active ? '' : ' inactive'}">
      ${p.photo_path ? imageTag(p.photo_path, '', { sizes: '64px', widths: [480] }) : `<span class="ph" style="display:grid;place-items:center;font-style:italic;font-size:1.5rem">${e(p.name[0])}</span>`}
      <div><span class="chip-person" style="--c:${e(p.color)}"><i></i><strong>${e(p.name)}</strong></span>${p.active ? '' : ' <span class="status">inativa</span>'}${p.accepts_online_booking ? '' : ' <span class="status">sem agenda online</span>'}
        <br><span class="muted">${p.service_ids.length} serviço${p.service_ids.length === 1 ? '' : 's'} · ${p.schedule.length ? scheduleSummary(p.schedule) : 'segue o horário do studio'}</span></div>
      ${canEdit ? `<button class="button button-quiet" type="button" data-edit="${p.id}">Editar</button>` : ''}</div>`).join('')}</section>`;
  el.onclick = (ev) => {
    const ed = ev.target.closest('[data-edit]'); if (ed) proForm(list.find((p) => p.id === ed.dataset.edit), cat, () => pros(el));
    if (ev.target.closest('[data-new]')) proForm(null, cat, () => pros(el));
  };
}
const scheduleSummary = (sch) => [...new Set(sch.map((r) => r.weekday))].map((w) => WEEKDAYS[w].slice(0, 3)).join(', ');

function hoursEditor(rows, name) {
  return `<div class="hours-editor" data-hours="${name}">${WEEKDAYS.map((w, i) => {
    const r = rows.filter((x) => x.weekday === i);
    return `<div class="hours-row" data-weekday="${i}"><strong>${w}</strong><div class="hours-ranges">
      ${r.map((x) => rangeRow(x.start, x.end)).join('') || '<p class="muted" data-closed>Fechado</p>'}
      <button class="link-plain" type="button" data-add-range style="justify-self:start">Adicionar intervalo</button></div></div>`;
  }).join('')}</div>`;
}
const rangeRow = (a = '08:00', b = '12:00') => `<div class="hours-range"><input class="field" type="time" step="900" value="${a}" aria-label="Início">
  <span>às</span><input class="field" type="time" step="900" value="${b}" aria-label="Fim"><button class="link-plain" type="button" data-del-range>Remover</button></div>`;
function bindHoursEditor(box) {
  box.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-add-range]')) {
      const ranges = ev.target.closest('.hours-ranges');
      ranges.querySelector('[data-closed]')?.remove();
      const last = [...ranges.querySelectorAll('.hours-range input')].at(-1)?.value;
      ev.target.insertAdjacentHTML('beforebegin', rangeRow(last || '08:00', last ? addHours(last, 4) : '12:00'));
    }
    if (ev.target.closest('[data-del-range]')) {
      const ranges = ev.target.closest('.hours-ranges');
      ev.target.closest('.hours-range').remove();
      if (!ranges.querySelector('.hours-range')) ranges.insertAdjacentHTML('afterbegin', '<p class="muted" data-closed>Fechado</p>');
    }
  });
}
const addHours = (t, h) => { const [a, b] = t.split(':').map(Number); return `${String(Math.min(23, a + h)).padStart(2, '0')}:${String(b).padStart(2, '0')}`; };
function readHours(box) {
  const out = [];
  box.querySelectorAll('.hours-row').forEach((row) => row.querySelectorAll('.hours-range').forEach((r) => {
    const [a, b] = r.querySelectorAll('input');
    if (a.value && b.value) out.push({ weekday: Number(row.dataset.weekday), start: a.value, end: b.value });
  }));
  return out;
}
function hoursError(rows) {
  for (const r of rows) if (r.end <= r.start) return `${WEEKDAYS[r.weekday]}: o fim precisa ser depois do início.`;
  return null;
}

function proForm(p, cat, refresh) {
  const own = Boolean(p?.schedule.length);
  const body = openSheet(p ? `Editar ${p.name}` : 'Nova profissional', `
    <form class="form" novalidate>
      <div class="form-grid">
        <div class="form-row"><label for="p-n">Nome</label><input class="field" id="p-n" name="name" value="${e(p?.name || '')}" required></div>
        <div class="form-row"><label for="p-c">Cor na agenda</label><input class="field" id="p-c" name="color" type="color" value="${e(p?.color || '#8a5a3c')}"></div>
      </div>
      <div class="form-row"><label for="p-b">Apresentação curta (aparece no agendamento)</label><input class="field" id="p-b" name="bio" maxlength="120" value="${e(p?.bio || '')}"></div>
      <div class="form-row"><label for="p-f">Foto</label><input class="field" id="p-f" type="file" accept="image/*" data-upload><input type="hidden" name="photo_path" value="${e(p?.photo_path || '')}"></div>
      <div class="checks"><label><input type="checkbox" name="active" ${!p || p.active ? 'checked' : ''}> Ativa</label>
        <label><input type="checkbox" name="accepts_online_booking" ${!p || p.accepts_online_booking ? 'checked' : ''}> Aparece na agenda online</label></div>
      <fieldset class="form-row" style="border:0;padding:0;margin:0"><legend style="font-size:.875rem;margin-bottom:.4rem">Serviços que realiza</legend>
        <div class="checks">${cat.services.map((s) => `<label><input type="checkbox" name="service_ids" value="${s.id}" data-multi ${p?.service_ids.includes(s.id) ? 'checked' : ''}> ${e(s.name)}</label>`).join('')}</div></fieldset>
      <fieldset class="form-row" style="border:0;padding:0;margin:0"><legend style="font-size:.875rem;margin-bottom:.4rem">Horário de trabalho</legend>
        <div class="checks"><label><input type="radio" name="own" value="0" ${own ? '' : 'checked'}> Segue o horário do studio</label>
          <label><input type="radio" name="own" value="1" ${own ? 'checked' : ''}> Horário próprio (folgas fixas, meio período)</label></div>
        <div data-own ${own ? '' : 'hidden'}>${hoursEditor(p?.schedule || [], 'pro')}</div>
        <p class="field-hint">O horário da profissional nunca ultrapassa o horário de funcionamento. Férias e folgas pontuais ficam em Bloqueios e folgas.</p></fieldset>
      <p class="field-error" role="alert" data-err></p>
      <div class="form-actions"><button class="button" type="submit">Salvar</button></div>
    </form>`);
  const form = body.querySelector('form');
  bindHoursEditor(body.querySelector('[data-hours]'));
  form.addEventListener('change', (ev) => { if (ev.target.name === 'own') body.querySelector('[data-own]').hidden = ev.target.value !== '1'; });
  body.querySelector('[data-upload]').addEventListener('change', async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    try { form.photo_path.value = await uploadImage(f, 'professionals'); toast('Foto enviada. Salve para aplicar.'); } catch (err) { toast(err.message); }
  });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = formData(form);
    const schedule = f.own === '1' ? readHours(body.querySelector('[data-hours]')) : [];
    const err = hoursError(schedule);
    if (err) { body.querySelector('[data-err]').textContent = err; return; }
    if (f.own === '1' && !schedule.length) { body.querySelector('[data-err]').textContent = 'Adicione pelo menos um intervalo ou escolha seguir o horário do studio.'; return; }
    const payload = { id: p?.id, name: f.name, color: f.color, bio: f.bio, photo_path: f.photo_path, active: f.active,
      accepts_online_booking: f.accepts_online_booking, service_ids: f.service_ids || [], schedule };
    try { await act(ev.submitter, () => rpc('admin_save_professional', { p: payload }), 'Profissional salva.'); store.pros = null; store.catalog = null; closeSheet(); refresh(); }
    catch (e2) { body.querySelector('[data-err]').textContent = e2.message; }
  });
}

// ============================================================== HORÁRIOS E REGRAS
export async function hours(el) {
  const cfg = await rpc('admin_get_availability_config');
  const pros = await professionals();
  const canEdit = can('owner', 'manager');
  const r = cfg.rules;
  const kind = { holiday: 'Feriado', closed: 'Fechado', custom_hours: 'Horário especial' };
  el.innerHTML = `
    <div class="view-head"><div><h1 class="view-title">Horários e regras</h1><p class="view-sub">Tudo aqui muda na hora os horários oferecidos no site.</p></div></div>
    <div class="grid-2">
      <section class="block"><h2 class="block-title">Horário de funcionamento</h2>
        <p class="field-hint" style="margin-bottom:.75rem">Para o almoço, use dois intervalos no mesmo dia (ex.: 08:00–12:00 e 13:00–19:00).</p>
        ${hoursEditor(cfg.business_hours, 'studio')}
        ${canEdit ? '<div class="form-actions"><button class="button" type="button" data-save-hours>Salvar horário</button></div>' : ''}
      </section>
      <section class="block"><h2 class="block-title">Regras da agenda online</h2>
        <form class="form" data-rules novalidate>
          <div class="form-grid">
            <div class="form-row"><label for="r1">Intervalo entre horários (min)</label><input class="field" id="r1" name="slot_step_minutes" type="number" min="5" max="120" step="5" value="${r.slot_step_minutes}"></div>
            <div class="form-row"><label for="r2">Preparo entre atendimentos (min)</label><input class="field" id="r2" name="default_buffer_minutes" type="number" min="0" max="120" step="5" value="${r.default_buffer_minutes}"></div>
            <div class="form-row"><label for="r3">Antecedência mínima (horas)</label><input class="field" id="r3" name="min_advance_hours" type="number" min="0" max="168" value="${r.min_advance_minutes / 60}"></div>
            <div class="form-row"><label for="r4">Agendar até (dias à frente)</label><input class="field" id="r4" name="max_advance_days" type="number" min="1" max="365" value="${r.max_advance_days}"></div>
            <div class="form-row"><label for="r5">Cancelar pelo site até (horas antes)</label><input class="field" id="r5" name="cancel_min_hours" type="number" min="0" value="${r.cancel_min_hours}"></div>
            <div class="form-row"><label for="r6">Reagendar pelo site até (horas antes)</label><input class="field" id="r6" name="reschedule_min_hours" type="number" min="0" value="${r.reschedule_min_hours}"></div>
            <div class="form-row"><label for="r7">Máximo de serviços por agendamento</label><input class="field" id="r7" name="max_services_per_booking" type="number" min="1" max="6" value="${r.max_services_per_booking}"></div>
          </div>
          <div class="checks">
            <label><input type="checkbox" name="auto_confirm" ${r.auto_confirm ? 'checked' : ''}> Confirmar automaticamente (sem revisão da equipe)</label>
            <label><input type="checkbox" name="allow_multiple_services" ${r.allow_multiple_services ? 'checked' : ''}> Permitir combinar serviços no mesmo horário</label>
          </div>
          ${canEdit ? '<div class="form-actions"><button class="button" type="submit">Salvar regras</button></div>' : ''}
        </form>
      </section>
    </div>
    <section class="block" style="margin-top:1rem"><h2 class="block-title">Feriados, dias fechados e horários especiais</h2>
      ${canEdit ? `<form class="toolbar" data-exc novalidate>
        <div class="form-row"><label for="x-d">Data</label><input class="field" id="x-d" type="date" name="date" required min="${todayISO()}"></div>
        <div class="form-row"><label for="x-k">Tipo</label><select class="field" id="x-k" name="kind"><option value="holiday">Feriado</option><option value="closed">Fechado</option><option value="custom_hours">Horário especial</option></select></div>
        <div class="form-row" data-x-time hidden><label for="x-s">Das</label><input class="field" id="x-s" type="time" name="start"></div>
        <div class="form-row" data-x-time hidden><label for="x-e">Até</label><input class="field" id="x-e" type="time" name="end"></div>
        <div class="form-row"><label for="x-p">Para</label><select class="field" id="x-p" name="professional_id"><option value="">Studio inteiro</option>${pros.map((p) => `<option value="${p.id}">${e(p.name)}</option>`).join('')}</select></div>
        <div class="form-row grow"><label for="x-r">Motivo</label><input class="field" id="x-r" name="reason" placeholder="Ex.: feriado municipal"></div>
        <button class="button" type="submit">Adicionar</button></form>` : ''}
      <div class="table-wrap"><table class="table"><thead><tr><th>Data</th><th>Tipo</th><th>Para</th><th>Motivo</th><th></th></tr></thead><tbody>
        ${cfg.exceptions.map((x) => `<tr><td>${e(formatDateFull(dateFromISO(x.date)))} <span class="muted">${e(WEEKDAYS[dateFromISO(x.date).getUTCDay()])}</span></td>
          <td>${kind[x.kind]}${x.kind === 'custom_hours' ? ` ${x.start}–${x.end}` : ''}</td><td>${x.professional_name ? e(x.professional_name) : 'Studio inteiro'}</td>
          <td>${e(x.reason || '')}</td><td class="num">${canEdit ? `<button class="link-plain" type="button" data-del-exc="${x.id}">Remover</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nenhuma exceção cadastrada.</td></tr>'}
      </tbody></table></div>
    </section>`;
  bindHoursEditor(el.querySelector('[data-hours]'));
  el.querySelector('[data-save-hours]')?.addEventListener('click', async (ev) => {
    const rows = readHours(el.querySelector('[data-hours]'));
    const err = hoursError(rows);
    if (err) { toast(err); return; }
    await act(ev.target, () => rpc('admin_save_business_hours', { p: rows }), 'Horário salvo.').catch(() => {});
  });
  el.querySelector('[data-rules]').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = formData(ev.target);
    const p = { ...f, min_advance_minutes: Math.round(Number(f.min_advance_hours) * 60) };
    delete p.min_advance_hours;
    Object.keys(p).forEach((k) => { if (typeof p[k] === 'string') p[k] = Number(p[k]); });
    await act(ev.submitter, () => rpc('admin_save_rules', { p }), 'Regras salvas.').catch(() => {});
  });
  const exc = el.querySelector('[data-exc]');
  exc?.addEventListener('change', (ev) => { if (ev.target.name === 'kind') exc.querySelectorAll('[data-x-time]').forEach((x) => { x.hidden = ev.target.value !== 'custom_hours'; }); });
  exc?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = formData(exc);
    if (!f.date) { toast('Escolha a data.'); return; }
    await act(ev.submitter, () => rpc('admin_save_exception', { p: f }), 'Exceção adicionada.').then(() => hours(el)).catch(() => {});
  });
  el.onclick = async (ev) => {
    const d = ev.target.closest('[data-del-exc]');
    if (d) { await act(d, () => rpc('admin_delete_exception', { p_id: d.dataset.delExc }), 'Removida.').catch(() => {}); hours(el); }
  };
}

// ============================================================== BLOQUEIOS
export async function blocks(el) {
  const [cfg, list] = await Promise.all([rpc('admin_get_availability_config'), professionals()]);
  const kinds = { block: 'Bloqueio', vacation: 'Férias', day_off: 'Folga', break: 'Pausa' };
  const t = todayISO();
  const upcoming = cfg.blocks.filter((b) => new Date(b.ends_at) >= new Date());
  el.innerHTML = `
    <div class="view-head"><div><h1 class="view-title">Bloqueios e folgas</h1><p class="view-sub">Bloqueie um horário, um intervalo, um dia ou um período de férias. O site deixa de oferecer esses horários na hora.</p></div></div>
    <div class="grid-2">
      <section class="block"><h2 class="block-title">Novo bloqueio</h2>
        <form class="form" data-block novalidate>
          <div class="form-grid">
            <div class="form-row"><label for="b-k">Tipo</label><select class="field" id="b-k" name="kind">${Object.entries(kinds).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
            <div class="form-row"><label for="b-p">Para</label><select class="field" id="b-p" name="professional_id"><option value="">Studio inteiro</option>${list.filter((p) => p.active).map((p) => `<option value="${p.id}">${e(p.name)}</option>`).join('')}</select></div>
            <div class="form-row full checks"><label><input type="checkbox" name="allday" checked data-allday> Dia(s) inteiro(s)</label></div>
            <div class="form-row"><label for="b-sd">Início</label><input class="field" id="b-sd" type="date" name="start_date" value="${t}" required></div>
            <div class="form-row" data-time hidden><label for="b-st">Hora inicial</label><input class="field" id="b-st" type="time" name="start_time" value="14:00" step="900"></div>
            <div class="form-row"><label for="b-ed">Fim</label><input class="field" id="b-ed" type="date" name="end_date" value="${t}" required></div>
            <div class="form-row" data-time hidden><label for="b-et">Hora final</label><input class="field" id="b-et" type="time" name="end_time" value="16:00" step="900"></div>
            <div class="form-row full"><label for="b-r">Motivo (só a equipe vê)</label><input class="field" id="b-r" name="reason" maxlength="200"></div>
          </div>
          <p class="field-error" role="alert" data-err></p>
          <div class="form-actions"><button class="button" type="submit">Bloquear</button></div>
        </form>
        <div data-conflicts></div>
      </section>
      <section class="block"><h2 class="block-title">Bloqueios atuais e futuros</h2>
        ${upcoming.length ? upcoming.map((b) => `<div class="queue-item"><p><strong>${kinds[b.kind]}</strong> · ${b.professional_name ? e(b.professional_name) : 'Studio inteiro'}<br>
          <span class="muted">${e(rangeLabel(b.starts_at, b.ends_at))}${b.reason ? ' · ' + e(b.reason) : ''}</span></p>
          <div class="queue-actions"><button class="button-back" type="button" data-del-block="${b.id}">Liberar</button></div></div>`).join('') : '<p class="empty">Nenhum bloqueio ativo.</p>'}
      </section>
    </div>`;
  const form = el.querySelector('[data-block]');
  form.addEventListener('change', (ev) => {
    if (ev.target.name === 'allday') form.querySelectorAll('[data-time]').forEach((x) => { x.hidden = ev.target.checked; });
    if (ev.target.name === 'start_date' && form.end_date.value < ev.target.value) form.end_date.value = ev.target.value;
  });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = formData(form);
    const start = f.allday ? ts(f.start_date, '00:00') : ts(f.start_date, f.start_time);
    const end = f.allday ? ts(addDays(f.end_date, 1), '00:00') : ts(f.end_date, f.end_time);
    if (new Date(end) <= new Date(start)) { el.querySelector('[data-err]').textContent = 'O fim precisa ser depois do início.'; return; }
    try {
      const r = await act(ev.submitter, () => rpc('admin_create_block', { p_professional_id: f.professional_id || null, p_starts_at: start, p_ends_at: end, p_kind: f.kind, p_reason: f.reason || null }), 'Horários bloqueados.');
      await blocks(el);
      if (r.conflicts.length) {
        el.querySelector('[data-conflicts]').innerHTML = `<p class="notice" style="margin-top:1rem">Atenção: ${r.conflicts.length} atendimento${r.conflicts.length > 1 ? 's já marcados' : ' já marcado'} nesse período. O bloqueio não cancela ninguém; reagende ou cancele se precisar:</p>
          ${r.conflicts.map((a) => `<button class="card" type="button" data-open="${a.id}"><span class="card-row"><strong>${e(formatDateShort(a.starts_at))}, ${formatTime(a.starts_at)}</strong>${statusTag(a.status)}</span><span>${e(a.client.name)} · ${e(svcNames(a))}</span></button>`).join('')}`;
      }
    } catch (err) { el.querySelector('[data-err]').textContent = err.message; }
  });
  el.onclick = async (ev) => {
    const d = ev.target.closest('[data-del-block]');
    if (d) { await act(d, () => rpc('admin_delete_block', { p_id: d.dataset.delBlock }), 'Horários liberados.').catch(() => {}); blocks(el); }
    const o = ev.target.closest('[data-open]'); if (o) openAppointment(o.dataset.open);
  };
}
function rangeLabel(a, b) {
  const s = new Date(a); const f = new Date(b);
  const sameDay = isoDate(s) === isoDate(new Date(f - 1));
  const midnight = (d) => formatTime(d) === '00:00';
  if (midnight(s) && midnight(f)) return sameDay ? `${formatDateFull(s)}, dia inteiro` : `${formatDateFull(s)} a ${formatDateFull(new Date(f - 1))}`;
  return sameDay ? `${formatDateFull(s)}, ${formatTime(s)} às ${formatTime(f)}` : `${formatDateFull(s)} ${formatTime(s)} a ${formatDateFull(f)} ${formatTime(f)}`;
}

// ============================================================== RELATÓRIOS
export async function reports(el, q) {
  let from = q.get('de') || `${todayISO().slice(0, 7)}-01`;
  let to = q.get('ate') || todayISO();
  el.innerHTML = `
    <div class="view-head"><div><h1 class="view-title">Relatórios</h1><p class="view-sub" data-period></p></div>
      <form class="toolbar" data-period-form style="margin:0">
        <div class="form-row"><label for="rp-de">De</label><input class="field" id="rp-de" type="date" name="from" value="${from}"></div>
        <div class="form-row"><label for="rp-ate">Até</label><input class="field" id="rp-ate" type="date" name="to" value="${to}"></div>
        <button class="button button-quiet" type="button" data-preset="month">Este mês</button>
        <button class="button button-quiet" type="button" data-preset="30">30 dias</button>
        <button class="button" type="button" data-csv>Exportar CSV</button>
      </form></div>
    <div data-report></div>`;
  const box = el.querySelector('[data-report]');
  async function load() {
    history.replaceState(null, '', `#/relatorios?de=${from}&ate=${to}`);
    el.querySelector('[data-period]').textContent = `${formatDateFull(dateFromISO(from))} a ${formatDateFull(dateFromISO(to))}`;
    box.innerHTML = '<p class="empty">Carregando…</p>';
    const r = await rpc('admin_reports', { p_from: from, p_to: to });
    const t = r.totals;
    const maxDay = Math.max(1, ...r.by_day.map((d) => d.count));
    const hoursSet = [...new Set(r.by_weekday_hour.map((x) => x.hour))].sort((a, b) => a - b);
    const maxHeat = Math.max(1, ...r.by_weekday_hour.map((x) => x.count));
    const cell = (w, h) => r.by_weekday_hour.find((x) => x.weekday === w && x.hour === h)?.count || 0;
    const cancelRate = t.total ? Math.round((t.cancelled / t.total) * 100) : 0;
    box.innerHTML = `
      <dl class="kpis">
        <div class="kpi"><dt>Agendamentos</dt><dd>${t.total}<small>${t.online} pelo site</small></dd></div>
        <div class="kpi"><dt>Concluídos</dt><dd>${t.completed}</dd></div>
        <div class="kpi"><dt>Cancelados</dt><dd>${t.cancelled}<small>${cancelRate}% · ${t.cancelled_by_client} pela cliente</small></dd></div>
        <div class="kpi"><dt>Não compareceram</dt><dd>${t.no_show}</dd></div>
        <div class="kpi"><dt>Receita prevista</dt><dd>${formatMoney(t.expected_cents)}<small>pendentes, confirmados e concluídos</small></dd></div>
        <div class="kpi"><dt>Receita realizada</dt><dd>${formatMoney(t.realized_cents)}<small>só atendimentos concluídos</small></dd></div>
      </dl>
      <section class="block"><h2 class="block-title">Agendamentos por dia</h2>
        <div class="cbars" style="--n:${r.by_day.length}" role="img" aria-label="Agendamentos por dia no período">${r.by_day.map((d) => `<div class="cbar${d.date === todayISO() ? ' is-today' : ''}" style="height:${(d.count / maxDay) * 100}%" title="${formatDateShort(dateFromISO(d.date))}: ${d.count} (${d.cancelled} cancelados)"></div>`).join('')}</div>
        <div class="cbars-axis"><span>${formatDateShort(dateFromISO(from))}</span><span>${formatDateShort(dateFromISO(to))}</span></div></section>
      <div class="grid-2" style="margin-top:1rem">
        <section class="block"><h2 class="block-title">Serviços mais agendados</h2>${hbars(r.by_service.map((s) => [s.name, s.count]))}</section>
        <section class="block"><h2 class="block-title">Horários mais movimentados</h2>
          ${hoursSet.length ? `<div class="heat" style="--cols:${hoursSet.length}"><span></span>${hoursSet.map((h) => `<span>${h}h</span>`).join('')}
            ${[2, 3, 4, 5, 6, 0, 1].map((w) => `<span>${WEEKDAYS[w].slice(0, 3)}</span>${hoursSet.map((h) => { const n = cell(w, h);
              return `<i style="opacity:${n ? 0.15 + 0.85 * (n / maxHeat) : 0.05}" title="${WEEKDAYS[w]} ${h}h: ${n}"></i>`; }).join('')}`).join('')}</div>` : '<p class="empty">Sem dados no período.</p>'}
        </section>
      </div>
      <section class="block" style="margin-top:1rem"><h2 class="block-title">Clientes recorrentes no período</h2>
        ${r.recurring_clients.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Cliente</th><th>WhatsApp</th><th class="num">Agendamentos</th></tr></thead>
          <tbody>${r.recurring_clients.map((c) => `<tr data-client="${c.id}" data-open tabindex="0"><td>${e(c.name)}</td><td>${e(formatPhone(c.phone))}</td><td class="num">${c.visits}</td></tr>`).join('')}</tbody></table></div>`
          : '<p class="empty">Nenhuma cliente com 2 ou mais agendamentos no período.</p>'}
      </section>`;
  }
  const form = el.querySelector('[data-period-form]');
  form.addEventListener('change', () => { const f = formData(form); if (f.from && f.to && f.from <= f.to) { from = f.from; to = f.to; load(); } });
  el.onclick = async (ev) => {
    const p = ev.target.closest('[data-preset]');
    if (p) { to = todayISO(); from = p.dataset.preset === 'month' ? `${to.slice(0, 7)}-01` : addDays(to, -29); form.from.value = from; form.to.value = to; load(); }
    if (ev.target.closest('[data-csv]')) {
      const rows = await act(ev.target, () => rpc('admin_export_appointments', { p_from: from, p_to: to })).catch(() => null);
      if (rows) downloadCsv(rows, `agendamentos-${from}-a-${to}.csv`);
    }
    const c = ev.target.closest('[data-client]'); if (c) openClient(c.dataset.client);
  };
  await load();
}

// ============================================================== CONFIGURAÇÕES
export async function settings(el) {
  const s = await rpc('admin_get_settings');
  const owner = can('owner');
  const ns = s.notification_stats || {};
  el.innerHTML = `
    <div class="view-head"><div><h1 class="view-title">Configurações</h1><p class="view-sub">${owner ? 'Dados do estabelecimento, políticas, notificações e acessos.' : 'Somente a proprietária pode alterar estas informações.'}</p></div></div>
    <form class="stack" data-settings novalidate>
      <fieldset ${owner ? '' : 'disabled'} style="border:0;padding:0;margin:0;display:grid;gap:1rem">
      <section class="block"><h2 class="block-title">Estabelecimento</h2>
        <div class="form-grid">
          <div class="form-row"><label for="st-n">Nome comercial</label><input class="field" id="st-n" name="trade_name" value="${e(s.trade_name)}"></div>
          <div class="form-row"><label for="st-t">Frase de apresentação</label><input class="field" id="st-t" name="tagline" value="${e(s.tagline || '')}"></div>
          <div class="form-row full"><label for="st-a">Sobre</label><textarea class="field" id="st-a" name="about" rows="3">${e(s.about || '')}</textarea></div>
          <div class="form-row"><label for="st-ad">Endereço</label><input class="field" id="st-ad" name="address_line" value="${e(s.address_line || '')}"></div>
          <div class="form-row"><label for="st-b">Bairro</label><input class="field" id="st-b" name="neighborhood" value="${e(s.neighborhood || '')}"></div>
          <div class="form-row"><label for="st-c">Cidade</label><input class="field" id="st-c" name="city" value="${e(s.city || '')}"></div>
          <div class="form-row"><label for="st-uf">UF</label><input class="field" id="st-uf" name="state" maxlength="2" value="${e(s.state || '')}"></div>
          <div class="form-row"><label for="st-cep">CEP</label><input class="field" id="st-cep" name="postal_code" value="${e(s.postal_code || '')}"></div>
          <div class="form-row"><label for="st-maps">Link do Google Maps</label><input class="field" id="st-maps" name="maps_url" value="${e(s.maps_url || '')}"></div>
          <div class="form-row"><label for="st-w">WhatsApp (com DDI e DDD)</label><input class="field" id="st-w" name="whatsapp" value="${e(s.whatsapp || '')}"></div>
          <div class="form-row"><label for="st-i">Instagram (usuário)</label><input class="field" id="st-i" name="instagram" value="${e(s.instagram || '')}"></div>
          <div class="form-row"><label for="st-e">E-mail de contato</label><input class="field" id="st-e" name="email" type="email" value="${e(s.email || '')}"></div>
          <div class="form-row"><label for="st-l">Logotipo</label><input class="field" id="st-l" type="file" accept="image/*" data-upload-logo><input type="hidden" name="logo_path" value="${e(s.logo_path || '')}"></div>
        </div>
      </section>
      <section class="block"><h2 class="block-title">Políticas exibidas no agendamento</h2>
        <div class="form-row"><label for="st-pb">Política de agendamento</label><textarea class="field" id="st-pb" name="booking_policy" rows="3">${e(s.booking_policy || '')}</textarea></div>
        <div class="form-row" style="margin-top:1rem"><label for="st-pc">Política de cancelamento</label><textarea class="field" id="st-pc" name="cancellation_policy" rows="3">${e(s.cancellation_policy || '')}</textarea></div>
        <div class="form-row" style="margin-top:1rem"><label for="st-pp">Contato para privacidade (LGPD)</label><input class="field" id="st-pp" name="privacy_contact" value="${e(s.privacy_contact || '')}"></div>
      </section>
      <section class="block"><h2 class="block-title">Notificações</h2>
        <p class="field-hint" style="margin-bottom:.75rem">Envios automáticos só acontecem depois de configurar o provedor de e-mail e/ou a API oficial do WhatsApp Business (veja o README). Até lá, use os botões de WhatsApp com mensagem pronta. Últimos 30 dias: ${Object.entries(ns).map(([k, v]) => `${v} ${({ sent: 'enviadas', failed: 'com falha', pending: 'na fila', skipped: 'ignoradas', processing: 'em envio' })[k] || k}`).join(', ') || 'nenhuma notificação'}.</p>
        <div class="checks">
          <label><input type="checkbox" name="notify_email_enabled" ${s.notify_email_enabled ? 'checked' : ''}> Enviar e-mails de confirmação, alteração e lembrete</label>
          <label><input type="checkbox" name="notify_whatsapp_enabled" ${s.notify_whatsapp_enabled ? 'checked' : ''}> Enviar mensagens pela API oficial do WhatsApp Business</label>
        </div>
        <div class="form-grid" style="margin-top:1rem">
          <div class="form-row"><label for="st-oe">E-mail da proprietária para avisos</label><input class="field" id="st-oe" name="notify_owner_email" type="email" value="${e(s.notify_owner_email || '')}"></div>
          <div class="form-row"><label for="st-rh">Lembrete (horas antes)</label><input class="field" id="st-rh" name="reminder_hours_before" type="number" min="1" max="168" value="${s.reminder_hours_before}"></div>
        </div>
      </section>
      ${owner ? '<div class="form-actions"><button class="button" type="submit">Salvar configurações</button></div>' : ''}
      </fieldset>
    </form>
    ${owner ? `<section class="block" style="margin-top:1rem"><h2 class="block-title">Acesso ao painel</h2>
      <p class="field-hint" style="margin-bottom:.75rem">Convide a pessoa em Supabase → Authentication → Users (ela cria a senha pelo e-mail) e depois conceda o acesso aqui.</p>
      <div class="table-wrap"><table class="table"><thead><tr><th>E-mail</th><th>Nome</th><th>Perfil</th><th></th></tr></thead><tbody>
        ${s.admins.map((a) => `<tr><td>${e(a.email || '')}</td><td>${e(a.display_name || '')}</td><td>${({ owner: 'Proprietária', manager: 'Gerente', staff: 'Equipe' })[a.role]}</td>
          <td class="num">${a.user_id !== store.me.user_id ? `<button class="link-plain" type="button" data-revoke="${a.user_id}">Remover acesso</button>` : '<span class="muted">você</span>'}</td></tr>`).join('')}
      </tbody></table></div>
      <form class="toolbar" data-grant style="margin-top:1rem" novalidate>
        <div class="form-row grow"><label for="g-e">E-mail</label><input class="field" id="g-e" name="email" type="email" required></div>
        <div class="form-row"><label for="g-n">Nome</label><input class="field" id="g-n" name="name"></div>
        <div class="form-row"><label for="g-r">Perfil</label><select class="field" id="g-r" name="role"><option value="staff">Equipe (agenda e clientes)</option><option value="manager">Gerente (tudo, exceto configurações)</option><option value="owner">Proprietária</option></select></div>
        <button class="button" type="submit">Conceder acesso</button>
      </form></section>
    <section class="block" style="margin-top:1rem"><h2 class="block-title">Registro de atividades</h2><div data-audit><button class="button button-quiet" type="button" data-load-audit>Mostrar últimas atividades</button></div></section>` : ''}`;
  el.querySelector('[data-upload-logo]')?.addEventListener('change', async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    try { el.querySelector('[name="logo_path"]').value = await uploadImage(f, 'brand'); toast('Logotipo enviado. Salve para aplicar.'); } catch (err) { toast(err.message); }
  });
  el.querySelector('[data-settings]').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const p = formData(ev.target);
    p.whatsapp = p.whatsapp.replace(/\D/g, '');
    p.reminder_hours_before = Number(p.reminder_hours_before);
    await act(ev.submitter, () => rpc('admin_save_settings', { p }), 'Configurações salvas.').catch(() => {});
  });
  el.querySelector('[data-grant]')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = formData(ev.target);
    await act(ev.submitter, () => rpc('admin_grant_access', { p_email: f.email, p_role: f.role, p_display_name: f.name || null }), 'Acesso concedido.').then(() => settings(el)).catch(() => {});
  });
  el.onclick = async (ev) => {
    const r = ev.target.closest('[data-revoke]');
    if (r) {
      const ok = await ask('Remover acesso?', 'A pessoa não conseguirá mais entrar no painel.', { ok: 'Remover', danger: true });
      closeSheet();
      if (ok) { await act(null, () => rpc('admin_revoke_access', { p_user_id: r.dataset.revoke }), 'Acesso removido.').catch(() => {}); settings(el); }
    }
    if (ev.target.closest('[data-load-audit]')) {
      const log = await rpc('admin_audit_log', { p_limit: 60 });
      el.querySelector('[data-audit]').innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Quando</th><th>Quem</th><th>Ação</th></tr></thead><tbody>
        ${log.map((l) => `<tr><td>${e(formatDateFull(l.created_at))} ${formatTime(l.created_at)}</td><td>${e(l.actor_kind === 'client' ? 'Cliente (site)' : l.actor)}</td><td>${e(l.action)}</td></tr>`).join('')}</tbody></table></div>`;
    }
  };
}
