// Supabase Edge Function: processa a fila de notificações (e-mail e WhatsApp oficial).
// Agende para rodar a cada 5 minutos (ver README). Nada é "simulado": sem credenciais, a notificação
// é marcada como "skipped" com o motivo, e o painel mostra a contagem.
//
// Variáveis (supabase secrets set ...):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (já existem nas Edge Functions)
//   SITE_URL                 ex.: https://www.studioludybrito.com.br
//   CRON_SECRET              segredo exigido no cabeçalho x-cron-secret
//   RESEND_API_KEY, EMAIL_FROM   (opcional) ex.: "Studio Ludy Brito <agenda@seudominio.com.br>"
//   WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TEMPLATE_LANG (pt_BR)   (opcional, API oficial da Meta)
//   WHATSAPP_TEMPLATE_CREATED, _CONFIRMED, _CANCELLED, _RESCHEDULED, _REMINDER  nomes dos modelos aprovados

const env = (k: string) => Deno.env.get(k) ?? '';
const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const SITE_URL = env('SITE_URL').replace(/\/$/, '');

type Job = {
  id: string; channel: 'email' | 'whatsapp'; audience: 'client' | 'owner';
  kind: 'created' | 'confirmed' | 'cancelled' | 'rescheduled' | 'reminder'; recipient: string; attempts: number;
  appointment: { protocol: string; status: string; date: string; time: string; services: string; professional: string;
    client_name: string; client_phone: string; manage_token: string };
  business: { name: string; whatsapp: string; address: string };
};

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${await r.text()}`);
  const t = await r.text();
  return (t ? JSON.parse(t) : null) as T;
}

const TITLES: Record<Job['kind'], string> = {
  created: 'Recebemos seu agendamento', confirmed: 'Agendamento confirmado', cancelled: 'Agendamento cancelado',
  rescheduled: 'Agendamento remarcado', reminder: 'Lembrete do seu horário',
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function emailFor(job: Job) {
  const a = job.appointment;
  const manage = SITE_URL ? `${SITE_URL}/meus-agendamentos/?p=${a.protocol}&t=${a.manage_token}` : '';
  if (job.audience === 'owner') {
    const subject = `${TITLES[job.kind]}: ${a.client_name}, ${a.date} ${a.time}`;
    const html = `<p>${esc(TITLES[job.kind])} pelo site.</p><p><b>${esc(a.client_name)}</b> · ${esc(a.client_phone)}<br>
      ${esc(a.services)} com ${esc(a.professional)}<br>${esc(a.date)} às ${esc(a.time)} · protocolo ${esc(a.protocol)}</p>`;
    return { subject, html };
  }
  const subject = `${TITLES[job.kind]} · ${job.business.name}`;
  const html = `<div style="font-family:Georgia,serif;font-size:16px;line-height:1.5;color:#2A1C16">
    <p>Olá, ${esc(a.client_name.split(' ')[0])}!</p>
    <p>${esc(TITLES[job.kind])}${job.kind === 'created' ? ' e ele aguarda a confirmação do studio' : ''}.</p>
    <p><b>${esc(a.services)}</b><br>${esc(a.date)} às ${esc(a.time)} · com ${esc(a.professional)}<br>Protocolo ${esc(a.protocol)}</p>
    <p>${esc(job.business.name)} · ${esc(job.business.address)}</p>
    ${manage && job.kind !== 'cancelled' ? `<p><a href="${manage}">Consultar, reagendar ou cancelar</a></p>` : ''}
    <p>Dúvidas? WhatsApp: https://wa.me/${esc(job.business.whatsapp)}</p></div>`;
  return { subject, html };
}

async function sendEmail(job: Job) {
  const key = env('RESEND_API_KEY'); const from = env('EMAIL_FROM');
  if (!key || !from) return { status: 'skipped', error: 'e-mail não configurado (RESEND_API_KEY/EMAIL_FROM)' };
  const { subject, html } = emailFor(job);
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': job.id },
    body: JSON.stringify({ from, to: [job.recipient], subject, html }),
  });
  return r.ok ? { status: 'sent' } : { status: r.status >= 500 ? 'pending' : 'failed', error: `resend ${r.status}: ${await r.text()}` };
}

async function sendWhatsApp(job: Job) {
  const token = env('WHATSAPP_TOKEN'); const phoneId = env('WHATSAPP_PHONE_NUMBER_ID');
  const template = env(`WHATSAPP_TEMPLATE_${job.kind.toUpperCase()}`);
  if (!token || !phoneId || !template) return { status: 'skipped', error: `WhatsApp Business não configurado (modelo ${job.kind})` };
  const a = job.appointment;
  // Modelo esperado com 4 variáveis: {{1}} nome, {{2}} serviço, {{3}} data, {{4}} horário.
  const r = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to: job.recipient, type: 'template',
      template: { name: template, language: { code: env('WHATSAPP_TEMPLATE_LANG') || 'pt_BR' },
        components: [{ type: 'body', parameters: [a.client_name.split(' ')[0], a.services, a.date, a.time].map((text) => ({ type: 'text', text })) }] },
    }),
  });
  return r.ok ? { status: 'sent' } : { status: r.status >= 500 ? 'pending' : 'failed', error: `whatsapp ${r.status}: ${await r.text()}` };
}

Deno.serve(async (req) => {
  const secret = env('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return new Response('forbidden', { status: 403 });
  // agenda lembretes e processa a fila
  await rpc<number>('enqueue_due_reminders', {});
  const jobs = await rpc<Job[]>('notification_claim_batch', { p_limit: 25 });
  const results: Record<string, number> = {};
  for (const job of jobs) {
    let out: { status: string; error?: string };
    try {
      out = job.channel === 'email' ? await sendEmail(job) : await sendWhatsApp(job);
    } catch (e) {
      out = { status: 'pending', error: String(e) };
    }
    if (out.status === 'pending' && job.attempts >= 5) out.status = 'failed';
    await rpc('notification_mark', { p_id: job.id, p_status: out.status, p_error: out.error ?? null });
    results[out.status] = (results[out.status] ?? 0) + 1;
  }
  return Response.json({ processed: jobs.length, results });
});
