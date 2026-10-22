// Painel: autenticação, casca e rotas.
import { auth, rpc, getSession, isConfigured } from '../api.js';
import { toast, ROOT } from '../format.js';
import { store, view } from './core.js';
import { setAfterChange } from './appointment.js';
import * as V from './views.js';

const $ = (s) => document.querySelector(s);
const authBox = $('[data-auth]');
const shell = $('[data-shell]');
const ROLE = { owner: 'Proprietária', manager: 'Gerente', staff: 'Equipe' };

const routes = {
  hoje: V.today, agenda: V.agenda, agendamentos: V.appointments, clientes: V.clients, servicos: V.services,
  profissionais: V.pros, horarios: V.hours, bloqueios: V.blocks, relatorios: V.reports, configuracoes: V.settings,
};

function showAuth(form = 'login') {
  shell.hidden = true; authBox.hidden = false;
  ['login', 'forgot', 'newpass'].forEach((f) => { $(`[data-${f}-form]`).hidden = f !== form; });
  $(`[data-${form}-form] input`)?.focus();
}

async function boot() {
  if (!isConfigured()) {
    showAuth();
    $('[data-auth-error]').textContent = 'Configure o Supabase em assets/js/config.js para usar o painel.';
    return;
  }
  const type = auth.adoptSessionFromUrl();
  if (type === 'recovery' || type === 'invite') { showAuth('newpass'); return; }
  if (!getSession()) { showAuth(); return; }
  try {
    store.me = await rpc('admin_me');
  } catch (err) {
    await auth.signOut();
    showAuth();
    $('[data-auth-error]').textContent = err.code === 'FORBIDDEN' ? 'Este usuário não tem acesso ao painel.' : err.message;
    return;
  }
  authBox.hidden = true; shell.hidden = false;
  $('[data-user-name]').textContent = store.me.name || store.me.email;
  $('[data-user-role]').textContent = ROLE[store.me.role] || store.me.role;
  document.querySelectorAll('[data-role]').forEach((el) => { el.hidden = !el.dataset.role.split(',').includes(store.me.role); });
  route();
}

let current = null;
async function route() {
  if (shell.hidden) return;
  const [name, query] = (location.hash.replace(/^#\/?/, '') || 'hoje').split('?');
  const fn = routes[name] || routes.hoje;
  current = name;
  document.querySelectorAll('.side-nav a, .tabbar a').forEach((a) => {
    if (a.getAttribute('href') === `#/${name}`) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.querySelector('.side').classList.remove('is-open');
  const titles = { hoje: 'Hoje', agenda: 'Agenda', agendamentos: 'Agendamentos', clientes: 'Clientes', servicos: 'Serviços',
    profissionais: 'Profissionais', horarios: 'Horários e regras', bloqueios: 'Bloqueios e folgas', relatorios: 'Relatórios', configuracoes: 'Configurações' };
  document.title = `${titles[name] || 'Painel'} · Studio Ludy Brito`;
  view().onclick = null;
  view().innerHTML = '<p class="empty">Carregando…</p>';
  try {
    await fn(view(), new URLSearchParams(query || ''));
  } catch (err) {
    if (err.status === 401 || err.code === 'NOT_AUTHENTICATED') { await auth.signOut(); showAuth(); return; }
    view().innerHTML = `<p class="notice notice-danger">${err.message}</p>`;
  }
  view().focus({ preventScroll: true });
}
window.addEventListener('hashchange', route);
setAfterChange(() => { if (['hoje', 'agenda', 'agendamentos', 'clientes'].includes(current)) route(); });

// ------------------------------------------------------------------ formulários de acesso
$('[data-login-form]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target; const err = $('[data-auth-error]'); err.textContent = '';
  const btn = f.querySelector('button[type="submit"]'); btn.disabled = true;
  try {
    await auth.signInWithPassword(f.email.value.trim(), f.password.value);
    f.password.value = '';
    await boot();
  } catch (ex) { err.textContent = ex.message; } finally { btn.disabled = false; }
});
$('[data-forgot]').addEventListener('click', () => showAuth('forgot'));
$('[data-back-login]').addEventListener('click', () => showAuth('login'));
$('[data-forgot-form]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target; const err = $('[data-forgot-error]'); err.textContent = '';
  try {
    await auth.sendPasswordReset(f.email.value.trim(), new URL(`${ROOT}admin/`, location.href).href);
    err.textContent = '';
    toast('Se o e-mail estiver cadastrado, você receberá um link em instantes.', 7000);
    showAuth('login');
  } catch (ex) { err.textContent = ex.message; }
});
$('[data-newpass-form]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target; const err = $('[data-newpass-error]');
  if (f.password.value.length < 8) { err.textContent = 'A senha precisa ter pelo menos 8 caracteres.'; return; }
  if (f.password.value !== f.password2.value) { err.textContent = 'As senhas não conferem.'; return; }
  try {
    await auth.updatePassword(f.password.value);
    toast('Senha salva.');
    await boot();
  } catch (ex) { err.textContent = ex.message; }
});
$('[data-signout]').addEventListener('click', async () => { await auth.signOut(); store.me = null; location.hash = ''; showAuth(); });
$('[data-more]').addEventListener('click', () => document.querySelector('.side').classList.toggle('is-open'));

boot();
