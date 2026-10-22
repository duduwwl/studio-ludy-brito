// Cliente mínimo para o Supabase (PostgREST RPC + Auth), sem dependências.
// Lê window.LB_CONFIG = { supabaseUrl, supabaseAnonKey } de assets/js/config.js.

const cfg = window.LB_CONFIG || {};
const BASE = (cfg.supabaseUrl || '').replace(/\/$/, '');
const KEY = cfg.supabaseAnonKey || '';
const SESSION_KEY = document.body?.dataset.sessionKey || cfg.sessionKey || 'lb.session';

export const isConfigured = () => Boolean(BASE && KEY);

// Mensagens amigáveis para os códigos de erro do banco.
const MESSAGES = {
  SLOT_TAKEN: 'Esse horário acabou de ser reservado. Escolha outro horário, por favor.',
  RATE_LIMITED: 'Muitas tentativas em pouco tempo. Aguarde alguns minutos ou fale com a gente pelo WhatsApp.',
  INVALID_PHONE: 'Informe um WhatsApp válido com DDD.',
  INVALID_NAME: 'Informe seu nome completo.',
  INVALID_EMAIL: 'Confira o e-mail informado.',
  CONSENT_REQUIRED: 'Para concluir, aceite a política de cancelamento e o aviso de privacidade.',
  BOOKING_NOT_FOUND: 'Não encontramos esse agendamento. Confira o link recebido na confirmação.',
  FORBIDDEN: 'Seu usuário não tem permissão para esta área.',
  NOT_AUTHENTICATED: 'Sua sessão expirou. Entre novamente.',
  NETWORK: 'Não foi possível conectar. Verifique sua internet e tente de novo.',
  NOT_CONFIGURED: 'O sistema de agendamento ainda não foi configurado.',
  invalid_credentials: 'E-mail ou senha incorretos.',
  otp_expired: 'O código expirou ou está incorreto. Peça um novo código.',
  over_email_send_rate_limit: 'Muitos e-mails enviados em pouco tempo. Aguarde um minuto e tente de novo.',
};

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message || MESSAGES[code] || 'Algo deu errado. Tente novamente.');
    this.code = code;
    this.status = status;
  }
}

// ---------------------------------------------------------------- sessão
let session = null;
try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { session = null; }
const listeners = new Set();

function saveSession(s) {
  session = s && s.access_token ? {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600),
    user: s.user ? { id: s.user.id, email: s.user.email } : session?.user || null,
  } : null;
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* armazenamento indisponível: sessão fica só em memória */ }
  listeners.forEach((fn) => fn(session));
}

export const onSessionChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const getSession = () => session;

let refreshing = null;
async function validToken() {
  if (!session) return null;
  if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
  if (!refreshing) {
    refreshing = authRequest('token?grant_type=refresh_token', { refresh_token: session.refresh_token })
      .then((s) => { saveSession(s); return s.access_token; })
      .catch(() => { saveSession(null); return null; })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

// ---------------------------------------------------------------- HTTP
async function request(path, { method = 'POST', body, auth = true, headers = {} } = {}) {
  if (!isConfigured()) throw new ApiError('NOT_CONFIGURED');
  const token = auth ? await validToken() : null;
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${token || KEY}`,
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('NETWORK');
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    if (res.status === 401 && auth && session) saveSession(null);
    const code = data?.message && /^[A-Z_]+$/.test(data.message) ? data.message
      : data?.error_code || data?.code || data?.error || `HTTP_${res.status}`;
    const detail = data?.details && typeof data.details === 'string' && !/^[A-Z_]+$/.test(data.details) ? data.details : null;
    const msg = MESSAGES[code] || detail || data?.msg || data?.error_description || null;
    throw new ApiError(code, msg, res.status);
  }
  return data;
}

// Chama uma função do banco (schema public).
export function rpc(fn, args = {}) {
  return request(`/rest/v1/rpc/${fn}`, { body: args });
}

function authRequest(path, body, method = 'POST') {
  return request(`/auth/v1/${path}`, { body, method, auth: false });
}

// ---------------------------------------------------------------- autenticação
export const auth = {
  async signInWithPassword(email, password) {
    const s = await authRequest('token?grant_type=password', { email, password });
    saveSession(s);
    return session;
  },
  // Envia um código de 6 dígitos ao e-mail (template "Magic Link" do Supabase precisa conter {{ .Token }}).
  sendEmailCode(email) {
    return authRequest('otp', { email, create_user: true });
  },
  async verifyEmailCode(email, token) {
    const s = await authRequest('verify', { type: 'email', email, token });
    saveSession(s);
    return session;
  },
  sendPasswordReset(email, redirectTo) {
    return request(`/auth/v1/recover${redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : ''}`,
      { body: { email }, auth: false });
  },
  // Usado depois de abrir o link de recuperação (o token chega no fragmento da URL).
  adoptSessionFromUrl() {
    const hash = new URLSearchParams(location.hash.slice(1));
    const at = hash.get('access_token');
    if (!at) return null;
    saveSession({
      access_token: at, refresh_token: hash.get('refresh_token'),
      expires_in: Number(hash.get('expires_in') || 3600),
      user: null,
    });
    history.replaceState(null, '', location.pathname + location.search);
    return hash.get('type');
  },
  async updatePassword(password) {
    const user = await request('/auth/v1/user', { method: 'PUT', body: { password } });
    if (session) saveSession({ ...session, user });
    return user;
  },
  async signOut() {
    try { if (session) await request('/auth/v1/logout', { body: {} }); } catch { /* sessão já inválida */ }
    saveSession(null);
  },
};

// ---------------------------------------------------------------- armazenamento de imagens (painel)
export async function uploadImage(file, folder = 'services') {
  if (!isConfigured()) throw new ApiError('NOT_CONFIGURED');
  if (!/^image\/(jpeg|png|webp|avif)$/.test(file.type)) throw new ApiError('INVALID_FILE', 'Envie uma imagem JPG, PNG, WebP ou AVIF.');
  if (file.size > 5 * 1024 * 1024) throw new ApiError('FILE_TOO_LARGE', 'A imagem pode ter até 5 MB.');
  const token = await validToken();
  const ext = file.type.split('/')[1].replace('jpeg', 'jpg');
  const name = `${folder}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  let res;
  try {
    res = await fetch(`${BASE}/storage/v1/object/media/${name}`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${token}`, 'Content-Type': file.type, 'x-upsert': 'false' },
      body: file,
    });
  } catch { throw new ApiError('NETWORK'); }
  if (!res.ok) throw new ApiError('UPLOAD_FAILED', 'Não foi possível enviar a imagem.', res.status);
  return `${BASE}/storage/v1/object/public/media/${name}`;
}

// Chave idempotente para não duplicar agendamentos em reenvios.
export function newIdempotencyKey() {
  if (crypto.randomUUID) return 'web-' + crypto.randomUUID();
  const a = new Uint8Array(16); crypto.getRandomValues(a);
  return 'web-' + [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}
