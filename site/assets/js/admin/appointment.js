// Detalhe, criação e edição de atendimentos no painel.
import { rpc } from '../api.js';
import {
  formatDateLong, formatTime, formatDuration, formatMoney, formatPhone, capitalize, STATUS_LABEL, isoDate, todayISO, toast,
  maskPhoneInput, formatDateFull,
} from '../format.js';
import { e, openSheet, closeSheet, ask, act, catalog, professionals, ts, onSheetClose } from './core.js';

let afterChange = () => {};
export const setAfterChange = (fn) => { afterChange = fn; };

const waLink = (a) => {
  const msg = `Olá, ${a.client.name.split(' ')[0]}! Aqui é do Studio Ludy Brito. ` +
    `Sobre o seu horário de ${a.services.map((s) => s.name).join(' + ')} em ${formatDateLong(a.starts_at)}, às ${formatTime(a.starts_at)} (protocolo ${a.protocol}).`;
  return `https://wa.me/${a.client.phone}?text=${encodeURIComponent(msg)}`;
};

export async function openAppointment(id) {
  let a;
  try { a = await rpc('admin_get_appointment', { p_id: id }); } catch (err) { toast(err.message); return; }
  const active = ['pending', 'confirmed'].includes(a.status);
  const past = new Date(a.starts_at) < Date.now();
  const body = openSheet(`${capitalize(formatDateLong(a.starts_at))}, ${formatTime(a.starts_at)}`, `
    <p><span class="status status-${a.status}">${STATUS_LABEL[a.status]}</span>
       <span class="muted">· Protocolo ${e(a.protocol)} · ${a.source === 'online' ? 'Agendado pelo site' : 'Criado pela equipe'}</span></p>
    <dl class="dl">
      <dt>Cliente</dt><dd><button class="link-plain" type="button" data-client="${a.client.id}">${e(a.client.name)}</button></dd>
      <dt>WhatsApp</dt><dd><a class="link-plain" href="${waLink(a)}" target="_blank" rel="noopener">${e(formatPhone(a.client.phone))}</a></dd>
      ${a.client.email ? `<dt>E-mail</dt><dd>${e(a.client.email)}</dd>` : ''}
      <dt>Serviço</dt><dd>${e(a.services.map((s) => s.name).join(' + '))}</dd>
      <dt>Profissional</dt><dd>${e(a.professional.name)}</dd>
      <dt>Horário</dt><dd>${formatTime(a.starts_at)} às ${formatTime(a.ends_at)} (${formatDuration(a.duration_minutes)})</dd>
      <dt>Valor</dt><dd>${a.total_price_cents == null ? '<span class="dash">Sob consulta</span>' : formatMoney(a.total_price_cents)}</dd>
      ${a.client_notes ? `<dt>Observação da cliente</dt><dd>${e(a.client_notes)}</dd>` : ''}
      ${a.cancel_reason ? `<dt>Motivo do cancelamento</dt><dd>${e(a.cancel_reason)}</dd>` : ''}
    </dl>
    <div class="action-row">
      ${a.status === 'pending' ? '<button class="button" type="button" data-status="confirmed">Confirmar</button>' : ''}
      ${active && past ? '<button class="button" type="button" data-status="completed">Marcar como concluído</button>' : ''}
      ${active && past ? '<button class="button button-quiet" type="button" data-status="no_show">Não compareceu</button>' : ''}
      ${active && !past ? '<button class="button button-quiet" type="button" data-status="completed">Concluído</button>' : ''}
      ${a.status !== 'cancelled' ? '<button class="button button-quiet" type="button" data-edit>Editar / reagendar</button>' : ''}
      ${active ? '<button class="button-back" type="button" data-status="cancelled">Cancelar</button>' : ''}
      ${['cancelled', 'no_show', 'completed'].includes(a.status) ? '<button class="button-back" type="button" data-status="confirmed">Reativar</button>' : ''}
    </div>
    <form class="form" data-notes>
      <div class="form-row"><label for="adm-notes">Observações da equipe</label>
      <textarea class="field" id="adm-notes" name="notes" rows="3" maxlength="1000">${e(a.admin_notes || '')}</textarea></div>
      <div class="form-actions"><button class="button button-quiet" type="submit">Salvar observação</button></div>
    </form>
    <div>
      <p class="block-title">Histórico</p>
      <div class="timeline-log">${a.history.map((h) => `<p>${formatDateFull(h.created_at)} ${formatTime(h.created_at)} · ${e(historyLabel(h))}</p>`).join('') || '<p>Sem registros.</p>'}</div>
    </div>`);

  body.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', async () => {
    const s = b.dataset.status;
    let reason = null;
    if (s === 'cancelled') {
      reason = await ask('Cancelar atendimento?', `${a.client.name} · ${formatDateLong(a.starts_at)}, ${formatTime(a.starts_at)}. O horário volta a ficar livre no site.`,
        { ok: 'Cancelar atendimento', danger: true, input: 'Motivo (opcional)' });
      if (reason === false) { openAppointment(id); return; }
    }
    try {
      await act(b, () => rpc('admin_set_appointment_status', { p_id: id, p_status: s, p_reason: reason || null }), `Status: ${STATUS_LABEL[s]}.`);
      afterChange();
    } catch { /* mensagem já exibida */ }
    openAppointment(id);
  }));
  body.querySelector('[data-edit]')?.addEventListener('click', () => openAppointmentForm({ appointment: a }));
  body.querySelector('[data-notes]').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await act(ev.submitter, () => rpc('admin_set_appointment_notes', { p_id: id, p_notes: ev.target.notes.value }), 'Observação salva.').catch(() => {});
  });
  body.querySelector('[data-client]').addEventListener('click', async () => {
    const { openClient } = await import('./views.js');
    openClient(a.client.id);
  });
}

function historyLabel(h) {
  const map = {
    'appointment.created': 'Agendamento criado', 'appointment.updated': 'Agendamento alterado', 'appointment.rescheduled': 'Reagendado pela cliente',
    'appointment.cancelled': 'Cancelado pela cliente', 'appointment.notes': 'Observação da equipe atualizada',
  };
  if (h.action === 'appointment.status') return `Status: ${STATUS_LABEL[h.details?.from] || h.details?.from} → ${STATUS_LABEL[h.details?.to] || h.details?.to}`;
  return `${map[h.action] || h.action}${h.actor_kind === 'admin' ? ' pela equipe' : ''}`;
}

// ---------------------------------------------------------------- formulário (novo / editar)
export async function openAppointmentForm({ appointment = null, date = null, time = null, professionalId = null } = {}) {
  const [cat, pros] = await Promise.all([catalog(), professionals()]);
  const a = appointment;
  const services = cat.services.filter((s) => s.active || a?.services.some((x) => x.id === s.id));
  const selected = new Set(a ? a.services.map((s) => s.id) : []);
  const d0 = a ? isoDate(new Date(a.starts_at)) : (date || todayISO());
  const t0 = a ? formatTime(a.starts_at) : time;
  const pro0 = a ? a.professional.id : (professionalId || pros.find((p) => p.active)?.id);
  let client = a ? a.client : null;

  const body = openSheet(a ? `Editar ${a.protocol}` : 'Novo agendamento', `
    <form class="form" data-appt-form novalidate>
      <fieldset class="form-row" style="border:0;padding:0;margin:0">
        <legend style="font-size:.875rem;margin-bottom:.4rem">Serviços</legend>
        <div class="checks">${services.map((s) => `<label><input type="checkbox" name="services" value="${s.id}" data-multi ${selected.has(s.id) ? 'checked' : ''}>
          ${e(s.name)} <span class="muted">· ${formatDuration(s.duration_minutes)}${s.price_cents != null ? ' · ' + formatMoney(s.price_cents) : ''}${s.active ? '' : ' · inativo'}</span></label>`).join('')}</div>
      </fieldset>
      <div class="form-grid">
        <div class="form-row"><label for="ap-pro">Profissional</label>
          <select class="field" id="ap-pro" name="pro">${pros.filter((p) => p.active || p.id === pro0).map((p) => `<option value="${p.id}" ${p.id === pro0 ? 'selected' : ''}>${e(p.name)}</option>`).join('')}</select></div>
        <div class="form-row"><label for="ap-date">Data</label><input class="field" id="ap-date" name="date" type="date" value="${d0}" required></div>
      </div>
      <div class="form-row">
        <p style="font-size:.875rem">Horários livres</p>
        <div class="slot-pick" data-slots><p class="muted">Escolha os serviços para ver os horários.</p></div>
      </div>
      <div class="checks"><label><input type="checkbox" name="outside" data-outside> Encaixe fora da grade (horário manual)</label></div>
      <div class="form-row" data-manual hidden><label for="ap-time">Horário manual</label><input class="field" id="ap-time" name="time" type="time" step="300" value="${t0 || ''}"></div>
      <div class="form-row typeahead">
        <label for="ap-client">Cliente</label>
        <input class="field" id="ap-client" type="search" autocomplete="off" placeholder="Buscar por nome ou WhatsApp" value="${a ? e(a.client.name) : ''}" data-client-search>
        <div class="typeahead-list" data-client-list hidden></div>
        <p class="field-hint" data-client-picked>${a ? `Selecionada: ${e(a.client.name)} · ${e(formatPhone(a.client.phone))}` : 'Não encontrou? Preencha os dados de uma nova cliente abaixo.'}</p>
      </div>
      <div class="form-grid" data-new-client ${a ? 'hidden' : ''}>
        <div class="form-row"><label for="ap-nname">Nome da nova cliente</label><input class="field" id="ap-nname" name="new_name" autocomplete="off"></div>
        <div class="form-row"><label for="ap-nphone">WhatsApp</label><input class="field" id="ap-nphone" name="new_phone" type="tel" inputmode="tel" placeholder="(35) 99999-9999"></div>
        <div class="form-row full"><label for="ap-nemail">E-mail (opcional)</label><input class="field" id="ap-nemail" name="new_email" type="email"></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label for="ap-status">Status</label>
          <select class="field" id="ap-status" name="status">
            ${['confirmed', 'pending', 'completed', 'no_show'].map((s) => `<option value="${s}" ${(a ? a.status : 'confirmed') === s ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}
          </select></div>
      </div>
      <div class="form-row"><label for="ap-notes">Observações da equipe</label><textarea class="field" id="ap-notes" name="notes" rows="2">${e(a?.admin_notes || '')}</textarea></div>
      <p class="field-error" data-form-error role="alert"></p>
      <div class="form-actions"><button class="button" type="submit">${a ? 'Salvar alterações' : 'Criar agendamento'}</button>
        <button class="button-back" type="button" data-cancel>Voltar</button></div>
    </form>`);

  const form = body.querySelector('form');
  let slot = a ? a.starts_at : null;
  const chosenServices = () => [...form.querySelectorAll('[name="services"]:checked')].map((i) => i.value);

  async function loadSlots() {
    const box = body.querySelector('[data-slots]');
    const svc = chosenServices();
    if (!svc.length) { box.innerHTML = '<p class="muted">Escolha os serviços para ver os horários.</p>'; return; }
    box.innerHTML = '<p class="muted">Buscando…</p>';
    try {
      const list = await rpc('admin_available_slots', { p_service_ids: svc, p_date: form.date.value, p_professional_id: form.pro.value, p_exclude_appointment: a?.id || null });
      if (!list.length) { box.innerHTML = '<p class="muted">Nenhum horário livre na grade desse dia. Use o encaixe, se fizer sentido.</p>'; slot = null; return; }
      if (slot && !list.some((s) => s.start === slot || new Date(s.start).getTime() === new Date(slot).getTime())) slot = null;
      box.innerHTML = list.map((s) => `<button type="button" data-start="${s.start}" aria-pressed="${slot && new Date(s.start).getTime() === new Date(slot).getTime()}">${s.time}</button>`).join('');
    } catch (err) { box.innerHTML = `<p class="field-error">${e(err.message)}</p>`; }
  }
  body.querySelector('[data-slots]').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-start]');
    if (!b) return;
    slot = b.dataset.start;
    body.querySelectorAll('[data-slots] button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  });
  form.addEventListener('change', (ev) => {
    if (['services', 'pro', 'date'].includes(ev.target.name)) loadSlots();
    if (ev.target.name === 'outside') body.querySelector('[data-manual]').hidden = !ev.target.checked;
  });
  form.querySelector('[name="new_phone"]').addEventListener('input', (ev) => { ev.target.value = maskPhoneInput(ev.target.value); });

  // busca de clientes
  const search = body.querySelector('[data-client-search]');
  const list = body.querySelector('[data-client-list]');
  let tmr;
  search.addEventListener('input', () => {
    clearTimeout(tmr);
    client = null;
    body.querySelector('[data-new-client]').hidden = false;
    body.querySelector('[data-client-picked]').textContent = 'Não encontrou? Preencha os dados de uma nova cliente abaixo.';
    const q = search.value.trim();
    if (q.length < 2) { list.hidden = true; return; }
    tmr = setTimeout(async () => {
      const r = await rpc('admin_list_clients', { p_search: q, p_limit: 8 }).catch(() => ({ rows: [] }));
      list.innerHTML = r.rows.map((c) => `<button type="button" data-id="${c.id}" data-name="${e(c.name)}" data-phone="${c.phone}">${e(c.name)} <span class="muted">${e(formatPhone(c.phone))}</span></button>`).join('')
        || '<p class="muted" style="padding:.6rem .75rem">Nenhuma cliente encontrada.</p>';
      list.hidden = false;
    }, 200);
  });
  list.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-id]');
    if (!b) return;
    client = { id: b.dataset.id, name: b.dataset.name, phone: b.dataset.phone };
    search.value = client.name;
    list.hidden = true;
    body.querySelector('[data-new-client]').hidden = true;
    body.querySelector('[data-client-picked]').textContent = `Selecionada: ${client.name} · ${formatPhone(client.phone)}`;
  });
  body.querySelector('[data-cancel]').addEventListener('click', () => (a ? openAppointment(a.id) : closeSheet()));

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = body.querySelector('[data-form-error]');
    err.textContent = '';
    const svc = chosenServices();
    const outside = form.outside.checked;
    let start = outside ? (form.time.value ? ts(form.date.value, form.time.value) : null) : slot;
    if (!svc.length) { err.textContent = 'Escolha pelo menos um serviço.'; return; }
    if (!start) { err.textContent = outside ? 'Informe o horário do encaixe.' : 'Escolha um horário livre ou marque o encaixe.'; return; }
    if (!client && (!form.new_name.value.trim() || !form.new_phone.value.trim())) { err.textContent = 'Selecione uma cliente ou preencha nome e WhatsApp da nova cliente.'; return; }
    try {
      const r = await act(ev.submitter, () => rpc('admin_save_appointment', {
        p_id: a?.id || null, p_service_ids: svc, p_professional_id: form.pro.value, p_start: start,
        p_client_id: client?.id || null, p_client_name: client ? null : form.new_name.value.trim(),
        p_client_phone: client ? null : form.new_phone.value, p_client_email: client ? null : (form.new_email.value.trim() || null),
        p_admin_notes: form.notes.value, p_status: form.status.value, p_outside_hours: outside,
      }), a ? 'Agendamento atualizado.' : 'Agendamento criado.');
      afterChange();
      openAppointment(r.id);
    } catch (e2) { err.textContent = e2.message; }
  });
  onSheetClose(null);
  if (t0 && !a) {
    // veio de um clique na agenda: pré-seleciona o horário se estiver livre
    slot = ts(d0, t0);
  }
  if (selected.size) loadSlots();
}
