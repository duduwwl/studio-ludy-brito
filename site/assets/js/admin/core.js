// Utilitários compartilhados do painel.
import { rpc } from '../api.js';
import { escapeHtml, toast } from '../format.js';

export const store = { me: null, catalog: null, pros: null };
export const OFFSET = '-03:00'; // America/Sao_Paulo (sem horário de verão desde 2019)
export const ts = (date, time) => `${date}T${time.length === 5 ? time + ':00' : time}${OFFSET}`;
export const e = escapeHtml;
export const view = () => document.querySelector('[data-view]');

export async function catalog(force = false) {
  if (!store.catalog || force) store.catalog = await rpc('admin_list_catalog');
  return store.catalog;
}
export async function professionals(force = false) {
  if (!store.pros || force) store.pros = await rpc('admin_list_professionals');
  return store.pros;
}
export const can = (...roles) => roles.includes(store.me?.role);

// ---------------------------------------------------------------- folha lateral
const sheet = () => document.querySelector('[data-sheet]');
let onCloseSheet = null;
export function openSheet(title, html, mount) {
  const s = sheet();
  s.querySelector('[data-sheet-title]').textContent = title;
  s.querySelector('[data-sheet-body]').onclick = null;
  s.querySelector('[data-sheet-body]').innerHTML = html;
  if (!s.open) s.showModal();
  s.querySelector('[data-sheet-body]').scrollTop = 0;
  onCloseSheet = null;
  mount?.(s.querySelector('[data-sheet-body]'));
  return s.querySelector('[data-sheet-body]');
}
export function closeSheet() { const s = sheet(); if (s.open) s.close(); }
export function onSheetClose(fn) { onCloseSheet = fn; }
queueMicrotask(() => {
  const s = sheet();
  if (!s) return;
  s.querySelector('[data-sheet-close]').addEventListener('click', () => s.close());
  s.addEventListener('close', () => { const fn = onCloseSheet; onCloseSheet = null; fn?.(); });
  s.addEventListener('click', (ev) => { if (ev.target === s) s.close(); });
});

// Confirmação dentro do painel (sem caixas nativas do navegador).
export function ask(title, message, { ok = 'Confirmar', danger = false, input = null } = {}) {
  return new Promise((resolve) => {
    const prev = sheet().open ? sheet().querySelector('[data-sheet-body]').innerHTML : null;
    const prevTitle = sheet().querySelector('[data-sheet-title]').textContent;
    const body = openSheet(title, `
      <p>${e(message)}</p>
      ${input ? `<div class="form-row"><label for="ask-input">${e(input)}</label><textarea class="field" id="ask-input" rows="2" maxlength="300"></textarea></div>` : ''}
      <div class="form-actions">
        <button class="button${danger ? ' button-danger' : ''}" type="button" data-ok>${e(ok)}</button>
        <button class="button-back" type="button" data-no>Voltar</button>
      </div>`);
    const done = (v) => {
      if (prev !== null) { sheet().querySelector('[data-sheet-title]').textContent = prevTitle; }
      resolve(v);
    };
    body.querySelector('[data-ok]').onclick = () => done(input ? (body.querySelector('#ask-input').value || '') : true);
    body.querySelector('[data-no]').onclick = () => done(false);
    onSheetClose(() => done(false));
  });
}

// Executa uma ação com feedback de carregamento e mensagem de erro amigável.
export async function act(button, fn, okMessage) {
  const label = button?.textContent;
  if (button) { button.disabled = true; button.textContent = 'Salvando…'; }
  try {
    const r = await fn();
    if (okMessage) toast(okMessage);
    return r;
  } catch (err) {
    toast(err.message || 'Não foi possível concluir.', 6000);
    throw err;
  } finally {
    if (button) { button.disabled = false; button.textContent = label; }
  }
}

export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') {
      if (el.dataset.multi !== undefined) { (out[el.name] ||= []); if (el.checked) out[el.name].push(el.value); }
      else out[el.name] = el.checked;
    } else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else out[el.name] = el.value;
  }
  return out;
}

export function downloadCsv(rows, filename) {
  if (!rows.length) { toast('Nada para exportar neste período.'); return; }
  const cols = Object.keys(rows[0]);
  const cell = (v) => {
    if (v == null) return '';
    let s = String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // evita fórmulas ao abrir no Excel
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + [cols.join(';'), ...rows.map((r) => cols.map((c) => cell(typeof r[c] === 'number' ? String(r[c]).replace('.', ',') : r[c])).join(';'))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
