// MODO DEMONSTRAÇÃO — usado apenas quando config.js tem { demo: true } (ex.: prévia sem Supabase).
// Reproduz as regras principais da agenda no navegador para visualizar o fluxo. Nada é salvo no servidor:
// as reservas ficam só neste navegador. Em produção, config.js aponta para o Supabase e este arquivo não é carregado.
import { ApiError } from './api.js';

const TZ_OFFSET = '-03:00';
const settings = {
  trade_name: 'Studio Ludy Brito', tagline: 'Mais que unhas: uma experiência de cuidado.',
  about: 'Esmalteria e cafeteria no Centro de Lavras. Há mais de 10 anos realçando a beleza das nossas clientes.',
  address_line: 'R. Bernardino Macieira, 334', neighborhood: 'Centro', city: 'Lavras', state: 'MG', postal_code: '37200-200',
  latitude: -21.237044, longitude: -44.999144, maps_url: 'https://maps.app.goo.gl/zp8FTsUzB4LQhaK97',
  whatsapp: '5535991260502', instagram: 'studioludybrito', timezone: 'America/Sao_Paulo',
  max_advance_days: 60, min_advance_minutes: 120, cancel_min_hours: 12, reschedule_min_hours: 12,
  allow_multiple_services: true, max_services_per_booking: 3,
  booking_policy: 'Chegue com 5 minutos de antecedência. O agendamento fica pendente até a confirmação do studio.',
  cancellation_policy: 'Cancelamentos e reagendamentos podem ser feitos pelo site até 12 horas antes do horário marcado.',
};
const PRO = { id: 'demo-ludy', name: 'Ludy Brito', slug: 'ludy-brito', bio: null, photo_path: null, accepts_online_booking: true };
const cats = [
  { id: 'c1', name: 'Mãos', slug: 'maos' }, { id: 'c2', name: 'Pés', slug: 'pes' }, { id: 'c3', name: 'Alongamento', slug: 'alongamento' },
];
const S = (id, c, name, slug, summary, description, dur, price, starting, combinable, alt) => ({
  id, category_id: c, name, slug, summary, description, duration_minutes: dur, price_cents: price, price_is_starting: starting,
  image_path: `images/services/${slug}`, image_alt: alt, bookable_online: true, combinable, professional_ids: [PRO.id], buffer: 10,
});
const services = [
  S('s1', 'c1', 'Manicure', 'manicure', 'Cutilagem, formato e esmaltação tradicional.', 'Cuidado completo das unhas das mãos: higienização, cutilagem, lixamento no formato que você preferir e esmaltação com esmalte tradicional.', 50, 3500, false, true, 'Cliente do studio com unhas esmaltadas em marsala'),
  S('s2', 'c1', 'Esmaltação em gel', 'esmaltacao-em-gel', 'Brilho e cor que duram semanas.', 'Preparação da unha natural e aplicação de esmalte em gel curado em cabine, com acabamento de alto brilho.', 75, 8000, false, true, 'Mãos com esmaltação azul com glitter feita no studio'),
  S('s3', 'c2', 'Pedicure', 'pedicure', 'Cutilagem, lixamento e esmaltação dos pés.', 'Higienização, cutilagem, lixamento e esmaltação tradicional das unhas dos pés.', 60, 4000, false, true, 'Pés com esmaltação branca'),
  S('s4', 'c2', 'Esmaltação em gel nos pés', 'esmaltacao-em-gel-nos-pes', 'A paz de uma esmaltação em gel nos pés.', 'Preparação das unhas dos pés e esmaltação em gel, com acabamento que resiste ao dia a dia e ao calçado aberto.', 70, 7000, false, true, 'Pés com esmaltação em gel francesinha feita no studio'),
  S('s5', 'c3', 'Alongamento em gel', 'alongamento-em-gel', 'Alongamento e esmaltação em gel no formato que você escolher.', 'Construção do alongamento em gel com formato e comprimento personalizados, finalizado com esmaltação em gel.', 150, 16000, true, false, 'Alongamento em gel nude com pontos de brilho feito no studio'),
  S('s6', 'c3', 'Manutenção de alongamento', 'manutencao-de-alongamento', 'Reposição do crescimento e nova esmaltação.', 'Manutenção do alongamento em gel: preenchimento da área de crescimento, ajuste do formato e nova esmaltação.', 120, 11000, true, false, 'Unhas alongadas em preto com francesinha dourada'),
];
services[4].buffer = 15; services[5].buffer = 15;
const hours = { 2: [['08:00', '19:00']], 3: [['08:00', '19:00']], 4: [['08:00', '19:00']], 5: [['08:00', '19:00']], 6: [['09:00', '13:00']] };
const holidays = new Set(['2026-11-02', '2026-11-20', '2026-12-25', '2027-01-01', '2027-03-26', '2027-04-21']);

const fail = (code, msg) => { throw new ApiError(code, msg); };
const load = () => { try { return JSON.parse(localStorage.getItem('lb.demo.bookings') || '[]'); } catch { return []; } };
const save = (list) => { try { localStorage.setItem('lb.demo.bookings', JSON.stringify(list)); } catch { /* ignora */ } };
const iso = (d) => new Date(d.getTime() - 3 * 36e5).toISOString().slice(0, 10);
const at = (date, hm) => new Date(`${date}T${hm}:00${TZ_OFFSET}`);
const hm = (d) => new Date(d.getTime() - 3 * 36e5).toISOString().slice(11, 16);

function bundle(ids) {
  const list = ids.map((id) => services.find((s) => s.id === id));
  if (!list.length || list.some((s) => !s)) fail('SERVICE_UNAVAILABLE', 'Serviço indisponível.');
  if (list.length > 1 && list.some((s) => !s.combinable)) fail('SERVICE_UNAVAILABLE', 'Essa combinação não pode ser agendada online.');
  return { duration: list.reduce((a, s) => a + s.duration_minutes, 0), buffer: Math.max(...list.map((s) => s.buffer)),
    price: list.reduce((a, s) => a + s.price_cents, 0), list };
}

function freeSlots(date, b, exclude) {
  const today = iso(new Date());
  const max = iso(new Date(Date.now() + settings.max_advance_days * 864e5));
  if (date < today || date > max || holidays.has(date)) return [];
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  const earliest = Date.now() + settings.min_advance_minutes * 6e4;
  const taken = load().filter((x) => x.status !== 'cancelled' && x.protocol !== exclude);
  const out = [];
  for (const [s, e] of hours[dow] || []) {
    for (let t = at(date, s).getTime(); t + b.duration * 6e4 <= at(date, e).getTime(); t += 30 * 6e4) {
      if (t < earliest) continue;
      const end = t + (b.duration + b.buffer) * 6e4;
      if (taken.some((x) => new Date(x.starts_at).getTime() < end && new Date(x.blocked_until).getTime() > t)) continue;
      out.push(new Date(t));
    }
  }
  return out;
}

function json(x) {
  const canChange = ['pending', 'confirmed'].includes(x.status) && new Date(x.starts_at) - 12 * 36e5 > Date.now();
  return { ...x, can_cancel: canChange, can_reschedule: canChange };
}

const handlers = {
  get_public_site: () => ({
    settings, categories: cats, services: services.map(({ buffer, ...s }) => s), professionals: [PRO],
    business_hours: Object.entries(hours).flatMap(([w, r]) => r.map(([s, e]) => ({ weekday: Number(w), start: s, end: e }))),
    today: iso(new Date()),
  }),
  get_availability_calendar: ({ p_service_ids, p_month }) => {
    const b = bundle(p_service_ids);
    const first = (p_month || iso(new Date())).slice(0, 7) + '-01';
    const d0 = new Date(`${first}T12:00:00Z`);
    const days = [];
    for (let d = new Date(d0); d.getUTCMonth() === d0.getUTCMonth(); d.setUTCDate(d.getUTCDate() + 1)) {
      const date = d.toISOString().slice(0, 10);
      const n = freeSlots(date, b).length;
      days.push({ date, available: n > 0, slots: n });
    }
    return { month: first.slice(0, 7), days, duration_minutes: b.duration, total_price_cents: b.price, has_price: true };
  },
  get_available_slots: ({ p_service_ids, p_date, p_protocol }) => {
    const b = bundle(p_service_ids);
    return { date: p_date, duration_minutes: b.duration, slots: freeSlots(p_date, b, p_protocol).map((t) => ({
      start: t.toISOString(), time: hm(t), period: hm(t) < '12:00' ? 'manha' : hm(t) < '18:00' ? 'tarde' : 'noite', professional_ids: [PRO.id] })) };
  },
  create_booking: (a) => {
    const list = load();
    const prev = list.find((x) => x.key === a.p_idempotency_key);
    if (prev) return json(prev);
    const digits = String(a.p_phone || '').replace(/\D/g, '');
    if (!/^[1-9][0-9]9?[0-9]{8}$/.test(digits)) fail('INVALID_PHONE');
    if ((a.p_full_name || '').trim().length < 3) fail('INVALID_NAME');
    if (!a.p_accept_policy || !a.p_accept_privacy) fail('CONSENT_REQUIRED');
    const b = bundle(a.p_service_ids);
    const date = iso(new Date(a.p_start));
    if (!freeSlots(date, b).some((t) => t.getTime() === new Date(a.p_start).getTime())) fail('SLOT_TAKEN');
    const start = new Date(a.p_start);
    const protocol = 'LB' + Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[01IO]/g, 'K');
    const x = {
      key: a.p_idempotency_key, protocol, token: Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2),
      status: 'pending', starts_at: start.toISOString(), ends_at: new Date(start.getTime() + b.duration * 6e4).toISOString(),
      blocked_until: new Date(start.getTime() + (b.duration + b.buffer) * 6e4).toISOString(), duration_minutes: b.duration,
      total_price_cents: b.price, professional: { id: PRO.id, name: PRO.name },
      services: b.list.map((s) => ({ id: s.id, name: s.name, duration_minutes: s.duration_minutes, price_cents: s.price_cents })),
      client: { name: a.p_full_name.trim(), phone_masked: `(${digits.slice(0, 2)}) •••••-${digits.slice(-4)}` },
      created_at: new Date().toISOString(),
    };
    list.push(x); save(list);
    return json(x);
  },
  get_booking: ({ p_protocol, p_token }) => {
    const x = load().find((y) => y.protocol === String(p_protocol).toUpperCase() && y.token === p_token);
    if (!x) fail('BOOKING_NOT_FOUND');
    return json(x);
  },
  cancel_booking: ({ p_protocol, p_token }) => {
    const list = load();
    const x = list.find((y) => y.protocol === p_protocol && y.token === p_token);
    if (!x) fail('BOOKING_NOT_FOUND');
    if (!json(x).can_cancel) fail('NOT_CANCELLABLE', 'Este agendamento não pode mais ser cancelado pelo site.');
    x.status = 'cancelled'; save(list);
    return json(x);
  },
  reschedule_booking: ({ p_protocol, p_token, p_new_start }) => {
    const list = load();
    const x = list.find((y) => y.protocol === p_protocol && y.token === p_token);
    if (!x) fail('BOOKING_NOT_FOUND');
    const b = bundle(x.services.map((s) => s.id));
    const start = new Date(p_new_start);
    if (!freeSlots(iso(start), b, x.protocol).some((t) => t.getTime() === start.getTime())) fail('SLOT_TAKEN');
    Object.assign(x, { starts_at: start.toISOString(), ends_at: new Date(start.getTime() + b.duration * 6e4).toISOString(),
      blocked_until: new Date(start.getTime() + (b.duration + b.buffer) * 6e4).toISOString() });
    save(list);
    return json(x);
  },
};

export async function rpc(fn, args) {
  await new Promise((r) => setTimeout(r, 120));
  if (!handlers[fn]) throw new ApiError('DEMO', 'Esta função não está disponível na demonstração. Configure o Supabase para usar o sistema completo.');
  return handlers[fn](args || {});
}
