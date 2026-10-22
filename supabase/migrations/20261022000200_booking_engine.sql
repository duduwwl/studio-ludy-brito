-- Studio Ludy Brito — motor de agenda (funções internas + API pública)
-- Toda a disponibilidade é calculada aqui, no servidor.

-- ---------------------------------------------------------------------------
-- Utilitários internos
-- ---------------------------------------------------------------------------
create or replace function private.settings() returns public.business_settings
language sql stable security definer set search_path = public, extensions as $$
  select * from public.business_settings where id = 1
$$;

create or replace function private.tz() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select timezone from public.business_settings where id = 1), 'America/Sao_Paulo')
$$;

create or replace function private.fail(code text, message text default null) returns void
language plpgsql as $$
begin
  raise exception '%', code using errcode = 'P0001', detail = coalesce(message, code);
end $$;

create or replace function private.admin_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.admin_roles where user_id = auth.uid()
$$;

create or replace function private.require_admin(allowed text[] default array['owner','manager','staff'])
returns text language plpgsql stable security definer set search_path = public as $$
declare r text;
begin
  r := private.admin_role();
  if r is null or not (r = any(allowed)) then
    raise exception 'FORBIDDEN' using errcode = '42501', detail = 'Acesso restrito à equipe autorizada.';
  end if;
  return r;
end $$;

create or replace function private.manage_token(p_id uuid, p_protocol text) returns text
language sql stable security definer set search_path = public, extensions as $$
  select substr(encode(extensions.hmac(p_id::text || ':' || p_protocol,
                (select value from private.app_secrets where name = 'manage_token_key'), 'sha256'), 'hex'), 1, 40)
$$;

create or replace function private.new_protocol() returns text
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  candidate text;
  bytes bytea;
begin
  loop
    bytes := extensions.gen_random_bytes(6);
    candidate := 'LB';
    for i in 0..5 loop
      candidate := candidate || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.appointments where protocol = candidate);
  end loop;
  return candidate;
end $$;

create or replace function private.normalize_phone(p text) returns text
language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if length(d) in (10, 11) then d := '55' || d; end if;
  if d !~ '^55[1-9][0-9]9?[0-9]{8}$' then
    raise exception 'INVALID_PHONE' using errcode = 'P0001', detail = 'Informe um WhatsApp válido com DDD.';
  end if;
  return d;
end $$;

create or replace function private.mask_phone(p text) returns text
language sql immutable as $$
  select case when p is null then null
    else '(' || substr(p, 3, 2) || ') ' || repeat('•', greatest(length(p) - 8, 1)) || '-' || right(p, 4) end
$$;

create or replace function private.client_ip() returns text
language sql stable as $$
  select coalesce(
    nullif(split_part(coalesce(current_setting('request.headers', true), '{}')::jsonb ->> 'x-forwarded-for', ',', 1), ''),
    coalesce(current_setting('request.headers', true), '{}')::jsonb ->> 'cf-connecting-ip',
    'unknown')
$$;

-- Limite simples por janela fixa. Lança RATE_LIMITED ao estourar.
create or replace function private.hit_rate_limit(p_bucket text, p_max int, p_window interval)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / extract(epoch from p_window)) * extract(epoch from p_window));
  n int;
begin
  insert into private.rate_limits as r (bucket, window_start, hits) values (p_bucket, w, 1)
  on conflict (bucket, window_start) do update set hits = r.hits + 1
  returning hits into n;
  if n > p_max then
    raise exception 'RATE_LIMITED' using errcode = 'P0001',
      detail = 'Muitas tentativas em pouco tempo. Aguarde alguns minutos ou fale conosco pelo WhatsApp.';
  end if;
  delete from private.rate_limits where window_start < now() - interval '2 days';
end $$;

create or replace function private.audit(p_actor_kind text, p_action text, p_entity text, p_entity_id text, p_details jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_logs (actor_id, actor_kind, action, entity, entity_id, details)
  values (auth.uid(), p_actor_kind, p_action, p_entity, p_entity_id, p_details)
$$;

-- ---------------------------------------------------------------------------
-- Intervalos de trabalho de uma profissional numa data (já no fuso do studio)
-- ---------------------------------------------------------------------------
create or replace function private.work_intervals(p_professional uuid, p_date date)
returns table (starts_at timestamptz, ends_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  tz text := private.tz();
  dow smallint := extract(dow from p_date);
  has_prof_schedule boolean;
begin
  -- Studio fechado (feriado / folga geral)
  if exists (select 1 from schedule_exceptions e where e.professional_id is null and e.date = p_date and e.kind in ('closed','holiday')) then
    return;
  end if;
  -- Profissional de folga nessa data
  if exists (select 1 from schedule_exceptions e where e.professional_id = p_professional and e.date = p_date and e.kind in ('closed','holiday')) then
    return;
  end if;

  select exists (select 1 from professional_schedules s where s.professional_id = p_professional) into has_prof_schedule;

  return query
  with base as (
    -- horário do studio no dia (especial, se houver, senão o semanal)
    select e.start_time s, e.end_time f from schedule_exceptions e
      where e.professional_id is null and e.date = p_date and e.kind = 'custom_hours'
    union all
    select b.start_time, b.end_time from business_hours b
      where b.weekday = dow
        and not exists (select 1 from schedule_exceptions e where e.professional_id is null and e.date = p_date and e.kind = 'custom_hours')
  ),
  prof as (
    select e.start_time s, e.end_time f from schedule_exceptions e
      where e.professional_id = p_professional and e.date = p_date and e.kind = 'custom_hours'
    union all
    select ps.start_time, ps.end_time from professional_schedules ps
      where has_prof_schedule and ps.professional_id = p_professional and ps.weekday = dow
        and not exists (select 1 from schedule_exceptions e where e.professional_id = p_professional and e.date = p_date and e.kind = 'custom_hours')
    union all
    select b.s, b.f from base b
      where not has_prof_schedule
        and not exists (select 1 from schedule_exceptions e where e.professional_id = p_professional and e.date = p_date and e.kind = 'custom_hours')
  ),
  inter as (
    select greatest(b.s, p.s) s, least(b.f, p.f) f from base b join prof p on greatest(b.s, p.s) < least(b.f, p.f)
  )
  select distinct ((p_date + i.s) at time zone tz), ((p_date + i.f) at time zone tz)
  from inter i order by 1;
end $$;

-- ---------------------------------------------------------------------------
-- Pacote de serviços validado: duração total, intervalo, preço
-- ---------------------------------------------------------------------------
create or replace function private.service_bundle(p_service_ids uuid[], p_online boolean)
returns table (duration int, buffer int, price_cents int, has_price boolean, names text[])
language plpgsql stable security definer set search_path = public as $$
declare
  st public.business_settings := private.settings();
  n int := coalesce(array_length(p_service_ids, 1), 0);
  found int;
begin
  if n = 0 then perform private.fail('NO_SERVICE', 'Escolha pelo menos um serviço.'); end if;
  if n <> (select count(distinct x) from unnest(p_service_ids) x) then
    perform private.fail('DUPLICATE_SERVICE', 'O mesmo serviço foi escolhido duas vezes.');
  end if;
  if n > 1 and p_online and (not st.allow_multiple_services or n > st.max_services_per_booking) then
    perform private.fail('TOO_MANY_SERVICES', 'Essa combinação de serviços não pode ser agendada online.');
  end if;
  select count(*) into found from services s
   where s.id = any(p_service_ids) and s.active
     and (not p_online or s.bookable_online)
     and (n = 1 or s.combinable);
  if found <> n then
    perform private.fail('SERVICE_UNAVAILABLE', 'Um dos serviços escolhidos não está disponível para agendamento.');
  end if;

  return query
  select sum(s.duration_minutes)::int,
         coalesce(max(s.buffer_after_minutes), st.default_buffer_minutes)::int,
         sum(s.price_cents)::int,
         bool_and(s.price_cents is not null),
         array_agg(s.name order by array_position(p_service_ids, s.id))
  from services s where s.id = any(p_service_ids);
end $$;

-- Profissionais aptas a fazer TODOS os serviços
create or replace function private.eligible_professionals(p_service_ids uuid[], p_online boolean)
returns setof uuid language sql stable security definer set search_path = public as $$
  select p.id from professionals p
  where p.active and (not p_online or p.accepts_online_booking)
    and (select count(*) from professional_services ps
          where ps.professional_id = p.id and ps.service_id = any(p_service_ids))
        = (select count(distinct x) from unnest(p_service_ids) x)
  order by p.sort_order, p.name
$$;

-- ---------------------------------------------------------------------------
-- Horários livres de UMA profissional num dia
-- ---------------------------------------------------------------------------
create or replace function private.free_slots(
  p_professional uuid, p_duration int, p_buffer int, p_date date,
  p_exclude_appointment uuid default null, p_enforce_window boolean default true)
returns setof timestamptz
language plpgsql stable security definer set search_path = public as $$
declare
  st public.business_settings := private.settings();
  tz text := private.tz();
  today date := (now() at time zone tz)::date;
  earliest timestamptz := case when p_enforce_window then now() + make_interval(mins => st.min_advance_minutes) else '-infinity' end;
  iv record;
begin
  if p_enforce_window and (p_date < today or p_date > today + st.max_advance_days) then
    return;
  end if;
  for iv in select * from private.work_intervals(p_professional, p_date) loop
    return query
    select t from generate_series(iv.starts_at,
                                  iv.ends_at - make_interval(mins => p_duration),
                                  make_interval(mins => st.slot_step_minutes)) t
    where t >= earliest
      and not exists (
        select 1 from appointments a
        where a.professional_id = p_professional and a.status <> 'cancelled'
          and (p_exclude_appointment is null or a.id <> p_exclude_appointment)
          and tstzrange(a.starts_at, a.blocked_until, '[)')
              && tstzrange(t, t + make_interval(mins => p_duration + p_buffer), '[)'))
      and not exists (
        select 1 from blocked_periods b
        where (b.professional_id is null or b.professional_id = p_professional)
          and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(t, t + make_interval(mins => p_duration), '[)'));
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Fila de notificações (só registra o que realmente será enviado)
-- ---------------------------------------------------------------------------
create or replace function private.enqueue_notifications(p_appointment uuid, p_kind text)
returns void language plpgsql security definer set search_path = public as $$
declare
  st public.business_settings := private.settings();
  a record;
  suffix text;
begin
  select ap.*, c.email client_email, c.phone client_phone into a
  from appointments ap join clients c on c.id = ap.client_id where ap.id = p_appointment;
  if not found then return; end if;
  suffix := case p_kind
    when 'rescheduled' then ':' || a.reschedule_count
    when 'reminder' then ':' || extract(epoch from a.starts_at)::bigint
    else '' end;

  if st.notify_email_enabled and a.client_email is not null then
    insert into notifications (appointment_id, channel, audience, kind, recipient, dedupe_key)
    values (a.id, 'email', 'client', p_kind, a.client_email, a.id || ':' || p_kind || ':email:client' || suffix)
    on conflict (dedupe_key) do nothing;
  end if;
  if st.notify_whatsapp_enabled then
    insert into notifications (appointment_id, channel, audience, kind, recipient, dedupe_key)
    values (a.id, 'whatsapp', 'client', p_kind, a.client_phone, a.id || ':' || p_kind || ':whatsapp:client' || suffix)
    on conflict (dedupe_key) do nothing;
  end if;
  if st.notify_email_enabled and st.notify_owner_email is not null and p_kind in ('created','cancelled','rescheduled') then
    insert into notifications (appointment_id, channel, audience, kind, recipient, dedupe_key)
    values (a.id, 'email', 'owner', p_kind, st.notify_owner_email, a.id || ':' || p_kind || ':email:owner' || suffix)
    on conflict (dedupe_key) do nothing;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Representação de um agendamento para a cliente
-- ---------------------------------------------------------------------------
create or replace function private.booking_json(p_id uuid, p_include_token boolean default true)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  st public.business_settings := private.settings();
  r jsonb;
begin
  select jsonb_build_object(
    'protocol', a.protocol,
    'token', case when p_include_token then private.manage_token(a.id, a.protocol) end,
    'status', a.status,
    'starts_at', a.starts_at,
    'ends_at', a.ends_at,
    'duration_minutes', a.total_duration_minutes,
    'total_price_cents', a.total_price_cents,
    'professional', jsonb_build_object('id', p.id, 'name', p.name),
    'services', (select coalesce(jsonb_agg(jsonb_build_object('id', s.service_id, 'name', s.service_name,
                   'duration_minutes', s.duration_minutes, 'price_cents', s.price_cents) order by s.position), '[]')
                 from appointment_services s where s.appointment_id = a.id),
    'client', jsonb_build_object('name', c.full_name, 'phone_masked', private.mask_phone(c.phone)),
    'client_notes', a.client_notes,
    'can_cancel', a.status in ('pending','confirmed') and a.starts_at - make_interval(hours => st.cancel_min_hours) > now(),
    'can_reschedule', a.status in ('pending','confirmed') and a.starts_at - make_interval(hours => st.reschedule_min_hours) > now(),
    'cancel_deadline', a.starts_at - make_interval(hours => st.cancel_min_hours),
    'created_at', a.created_at)
  into r
  from appointments a
  join professionals p on p.id = a.professional_id
  join clients c on c.id = a.client_id
  where a.id = p_id;
  return r;
end $$;

create or replace function private.find_booking(p_protocol text, p_token text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare a record;
begin
  select id, protocol into a from appointments where protocol = upper(trim(p_protocol));
  if not found or p_token is null or private.manage_token(a.id, a.protocol) <> p_token then
    raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0001',
      detail = 'Não encontramos esse agendamento. Confira o link recebido na confirmação.';
  end if;
  return a.id;
end $$;

-- ===========================================================================
-- API PÚBLICA
-- ===========================================================================

-- Dados públicos do site: estabelecimento, catálogo, equipe, horários.
create or replace function public.get_public_site()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'settings', (select jsonb_build_object(
        'trade_name', trade_name, 'tagline', tagline, 'about', about,
        'address_line', address_line, 'neighborhood', neighborhood, 'city', city, 'state', state,
        'postal_code', postal_code, 'latitude', latitude, 'longitude', longitude, 'maps_url', maps_url,
        'whatsapp', whatsapp, 'instagram', instagram, 'email', email, 'logo_path', logo_path,
        'timezone', timezone, 'max_advance_days', max_advance_days, 'min_advance_minutes', min_advance_minutes,
        'cancel_min_hours', cancel_min_hours, 'reschedule_min_hours', reschedule_min_hours,
        'allow_multiple_services', allow_multiple_services, 'max_services_per_booking', max_services_per_booking,
        'booking_policy', booking_policy, 'cancellation_policy', cancellation_policy,
        'privacy_contact', privacy_contact)
      from business_settings where id = 1),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'slug', slug,
        'description', description) order by sort_order, name), '[]') from service_categories),
    'services', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'category_id', s.category_id, 'name', s.name, 'slug', s.slug, 'summary', s.summary,
        'description', s.description, 'duration_minutes', s.duration_minutes, 'price_cents', s.price_cents,
        'price_is_starting', s.price_is_starting, 'image_path', s.image_path, 'image_alt', s.image_alt,
        'bookable_online', s.bookable_online, 'combinable', s.combinable,
        'professional_ids', (select coalesce(jsonb_agg(ps.professional_id), '[]') from professional_services ps
                              join professionals p on p.id = ps.professional_id and p.active
                              where ps.service_id = s.id))
        order by s.sort_order, s.name), '[]') from services s where s.active),
    'professionals', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'slug', slug,
        'bio', bio, 'photo_path', photo_path, 'accepts_online_booking', accepts_online_booking)
        order by sort_order, name), '[]') from professionals where active),
    'business_hours', (select coalesce(jsonb_agg(jsonb_build_object('weekday', weekday,
        'start', to_char(start_time, 'HH24:MI'), 'end', to_char(end_time, 'HH24:MI'))
        order by weekday, start_time), '[]') from business_hours),
    'today', (now() at time zone private.tz())::date
  )
$$;

-- Dias do mês com disponibilidade.
create or replace function public.get_availability_calendar(
  p_service_ids uuid[], p_professional_id uuid default null, p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  b record;
  first_day date := date_trunc('month', coalesce(p_month, (now() at time zone private.tz())::date))::date;
  last_day date := (date_trunc('month', first_day) + interval '1 month - 1 day')::date;
  profs uuid[];
  result jsonb := '[]';
  d date;
  n int;
begin
  select * into b from private.service_bundle(p_service_ids, true);
  if p_professional_id is null then
    select array_agg(x) into profs from private.eligible_professionals(p_service_ids, true) x;
  elsif p_professional_id in (select private.eligible_professionals(p_service_ids, true)) then
    profs := array[p_professional_id];
  else
    perform private.fail('PROFESSIONAL_UNAVAILABLE', 'Essa profissional não realiza o(s) serviço(s) escolhido(s).');
  end if;

  d := first_day;
  while d <= last_day loop
    select count(distinct t) into n
      from unnest(coalesce(profs, '{}')) pid, lateral private.free_slots(pid, b.duration, b.buffer, d) t;
    result := result || jsonb_build_object('date', d, 'available', n > 0, 'slots', n);
    d := d + 1;
  end loop;
  return jsonb_build_object('month', to_char(first_day, 'YYYY-MM'), 'days', result,
                            'duration_minutes', b.duration, 'total_price_cents', b.price_cents,
                            'has_price', b.has_price);
end $$;

-- Horários livres de um dia. Para reagendamento, passe protocolo + token (o próprio horário não conta como ocupado).
create or replace function public.get_available_slots(
  p_service_ids uuid[], p_date date, p_professional_id uuid default null,
  p_protocol text default null, p_token text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  b record;
  profs uuid[];
  exclude_id uuid;
  tz text := private.tz();
begin
  if p_protocol is not null then
    exclude_id := private.find_booking(p_protocol, p_token);
  end if;
  select * into b from private.service_bundle(p_service_ids, true);
  if p_professional_id is null then
    select array_agg(x) into profs from private.eligible_professionals(p_service_ids, true) x;
  elsif p_professional_id in (select private.eligible_professionals(p_service_ids, true)) then
    profs := array[p_professional_id];
  else
    perform private.fail('PROFESSIONAL_UNAVAILABLE', 'Essa profissional não realiza o(s) serviço(s) escolhido(s).');
  end if;

  return jsonb_build_object(
    'date', p_date,
    'duration_minutes', b.duration,
    'slots', (select coalesce(jsonb_agg(jsonb_build_object(
                  'start', t, 'time', to_char(t at time zone tz, 'HH24:MI'),
                  'period', case when (t at time zone tz)::time < '12:00' then 'manha'
                                 when (t at time zone tz)::time < '18:00' then 'tarde' else 'noite' end,
                  'professional_ids', pids) order by t), '[]')
              from (select t, jsonb_agg(pid) pids
                    from unnest(coalesce(profs, '{}')) pid,
                         lateral private.free_slots(pid, b.duration, b.buffer, p_date, exclude_id) t
                    group by t) x));
end $$;

-- Cria um agendamento. Revalida a disponibilidade dentro da transação; a restrição de exclusão
-- garante que duas reservas simultâneas nunca se sobreponham.
create or replace function public.create_booking(
  p_service_ids uuid[],
  p_start timestamptz,
  p_full_name text,
  p_phone text,
  p_professional_id uuid default null,
  p_email text default null,
  p_notes text default null,
  p_accept_policy boolean default false,
  p_accept_privacy boolean default false,
  p_idempotency_key text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  st public.business_settings := private.settings();
  tz text := private.tz();
  b record;
  v_phone text;
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_name text := regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
  existing uuid;
  v_client uuid;
  cand uuid;
  chosen uuid;
  appt uuid;
  proto text;
  local_date date := (p_start at time zone tz)::date;
begin
  -- Idempotência: repetir a mesma requisição devolve o mesmo agendamento.
  if p_idempotency_key is not null then
    if length(p_idempotency_key) not between 16 and 80 then
      perform private.fail('INVALID_REQUEST', 'Requisição inválida.');
    end if;
    select id into existing from appointments where idempotency_key = p_idempotency_key;
    if existing is not null then
      return private.booking_json(existing);
    end if;
  end if;

  -- Validações
  if length(v_name) < 3 or length(v_name) > 120 or v_name !~ '[[:alpha:]]' then
    perform private.fail('INVALID_NAME', 'Informe seu nome completo.');
  end if;
  v_phone := private.normalize_phone(p_phone);
  if v_email is not null and v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    perform private.fail('INVALID_EMAIL', 'Confira o e-mail informado.');
  end if;
  if v_notes is not null and length(v_notes) > 500 then
    perform private.fail('NOTES_TOO_LONG', 'As observações podem ter até 500 caracteres.');
  end if;
  if not coalesce(p_accept_policy, false) or not coalesce(p_accept_privacy, false) then
    perform private.fail('CONSENT_REQUIRED', 'Para concluir, aceite a política de cancelamento e o aviso de privacidade.');
  end if;

  perform private.hit_rate_limit('booking:phone:' || v_phone, 4, interval '1 hour');
  perform private.hit_rate_limit('booking:ip:' || private.client_ip(), 20, interval '1 hour');

  select * into b from private.service_bundle(p_service_ids, true);

  if p_professional_id is not null
     and p_professional_id not in (select private.eligible_professionals(p_service_ids, true)) then
    perform private.fail('PROFESSIONAL_UNAVAILABLE', 'Essa profissional não realiza o(s) serviço(s) escolhido(s).');
  end if;

  -- Cliente (identificada pelo WhatsApp)
  insert into clients (full_name, phone, email, privacy_consent_at)
  values (v_name, v_phone, v_email, now())
  on conflict (phone) do update
    set full_name = excluded.full_name,
        email = coalesce(excluded.email, clients.email),
        privacy_consent_at = now()
  returning id into v_client;

  proto := private.new_protocol();

  -- Tenta cada profissional elegível com o horário livre (menos ocupada no dia primeiro).
  for cand in
    select pid from (
      select pid,
        (select count(*) from appointments a where a.professional_id = pid and a.status <> 'cancelled'
           and (a.starts_at at time zone tz)::date = local_date) load,
        (select sort_order from professionals where id = pid) so
      from private.eligible_professionals(p_service_ids, true) pid
      where (p_professional_id is null or pid = p_professional_id)
    ) x
    where p_start in (select private.free_slots(pid, b.duration, b.buffer, local_date))
    order by load, so
  loop
    begin
      insert into appointments (protocol, client_id, professional_id, starts_at, ends_at, blocked_until,
        status, total_price_cents, total_duration_minutes, client_notes, source, idempotency_key, policy_accepted_at)
      values (proto, v_client, cand, p_start,
        p_start + make_interval(mins => b.duration),
        p_start + make_interval(mins => b.duration + b.buffer),
        case when st.auto_confirm then 'confirmed' else 'pending' end,
        case when b.has_price then b.price_cents end, b.duration, v_notes, 'online', p_idempotency_key, now())
      returning id into appt;
      chosen := cand;
      exit;
    exception when exclusion_violation then
      -- outra cliente reservou este horário com esta profissional neste instante; tenta a próxima
      continue;
    end;
  end loop;

  if chosen is null then
    perform private.fail('SLOT_TAKEN', 'Esse horário acabou de ser reservado. Escolha outro horário, por favor.');
  end if;

  insert into appointment_services (appointment_id, position, service_id, service_name, duration_minutes, price_cents)
  select appt, row_number() over (order by array_position(p_service_ids, s.id)), s.id, s.name, s.duration_minutes, s.price_cents
  from services s where s.id = any(p_service_ids);

  perform private.enqueue_notifications(appt, 'created');
  perform private.audit('client', 'appointment.created', 'appointment', appt::text,
                        jsonb_build_object('protocol', proto, 'starts_at', p_start, 'professional_id', chosen));
  return private.booking_json(appt);
end $$;

-- Consulta pelo link seguro (protocolo + token).
create or replace function public.get_booking(p_protocol text, p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  return private.booking_json(private.find_booking(p_protocol, p_token));
end $$;

create or replace function public.cancel_booking(p_protocol text, p_token text, p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  st public.business_settings := private.settings();
  v_id uuid;
  a record;
begin
  perform private.hit_rate_limit('manage:ip:' || private.client_ip(), 60, interval '1 hour');
  v_id := private.find_booking(p_protocol, p_token);
  select * into a from appointments where appointments.id = v_id for update;
  if a.status not in ('pending','confirmed') then
    perform private.fail('NOT_CANCELLABLE', 'Este agendamento não pode mais ser cancelado.');
  end if;
  if a.starts_at - make_interval(hours => st.cancel_min_hours) <= now() then
    perform private.fail('CANCEL_WINDOW_CLOSED',
      format('Cancelamentos online são aceitos até %s horas antes. Fale conosco pelo WhatsApp.', st.cancel_min_hours));
  end if;
  update appointments set status = 'cancelled', cancelled_at = now(), cancelled_by = 'client',
         cancel_reason = left(nullif(trim(coalesce(p_reason, '')), ''), 300)
   where appointments.id = a.id;
  perform private.enqueue_notifications(a.id, 'cancelled');
  perform private.audit('client', 'appointment.cancelled', 'appointment', a.id::text, null);
  return private.booking_json(a.id);
end $$;

create or replace function public.reschedule_booking(
  p_protocol text, p_token text, p_new_start timestamptz, p_professional_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  st public.business_settings := private.settings();
  tz text := private.tz();
  v_id uuid;
  a record;
  svc uuid[];
  b record;
  cand uuid;
  chosen uuid;
  local_date date := (p_new_start at time zone tz)::date;
begin
  perform private.hit_rate_limit('manage:ip:' || private.client_ip(), 60, interval '1 hour');
  v_id := private.find_booking(p_protocol, p_token);
  select * into a from appointments where appointments.id = v_id for update;
  if a.status not in ('pending','confirmed') then
    perform private.fail('NOT_RESCHEDULABLE', 'Este agendamento não pode ser reagendado.');
  end if;
  if a.starts_at - make_interval(hours => st.reschedule_min_hours) <= now() then
    perform private.fail('RESCHEDULE_WINDOW_CLOSED',
      format('Reagendamentos online são aceitos até %s horas antes. Fale conosco pelo WhatsApp.', st.reschedule_min_hours));
  end if;
  if a.reschedule_count >= 3 then
    perform private.fail('RESCHEDULE_LIMIT', 'Este agendamento já foi remarcado várias vezes. Fale conosco pelo WhatsApp.');
  end if;

  select array_agg(service_id order by position) into svc from appointment_services where appointment_id = a.id;
  if svc is null or array_position(svc, null) is not null then
    perform private.fail('SERVICE_UNAVAILABLE', 'Um dos serviços deste agendamento não está mais disponível online.');
  end if;
  select * into b from private.service_bundle(svc, true);

  for cand in
    select pid from private.eligible_professionals(svc, true) pid
    where (pid = coalesce(p_professional_id, a.professional_id) or (p_professional_id is null and pid <> a.professional_id))
      and p_new_start in (select private.free_slots(pid, b.duration, b.buffer, local_date, a.id))
    order by (pid = coalesce(p_professional_id, a.professional_id)) desc
  loop
    begin
      update appointments
         set professional_id = cand, starts_at = p_new_start,
             ends_at = p_new_start + make_interval(mins => b.duration),
             blocked_until = p_new_start + make_interval(mins => b.duration + b.buffer),
             total_duration_minutes = b.duration,
             reschedule_count = reschedule_count + 1,
             status = case when st.auto_confirm then 'confirmed' else 'pending' end
       where appointments.id = a.id;
      chosen := cand;
      exit;
    exception when exclusion_violation then
      continue;
    end;
  end loop;

  if chosen is null then
    perform private.fail('SLOT_TAKEN', 'Esse horário não está mais disponível. Escolha outro, por favor.');
  end if;
  perform private.enqueue_notifications(a.id, 'rescheduled');
  perform private.audit('client', 'appointment.rescheduled', 'appointment', a.id::text,
                        jsonb_build_object('from', a.starts_at, 'to', p_new_start, 'professional_id', chosen));
  return private.booking_json(a.id);
end $$;

-- Área da cliente autenticada por código enviado ao e-mail (Supabase Auth OTP).
create or replace function public.my_appointments()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_email text := lower(auth.jwt() ->> 'email');
begin
  if auth.uid() is null or v_email is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501', detail = 'Entre com o código enviado ao seu e-mail.';
  end if;
  return jsonb_build_object(
    'email', v_email,
    'upcoming', (select coalesce(jsonb_agg(private.booking_json(a.id) order by a.starts_at), '[]')
                 from appointments a join clients c on c.id = a.client_id
                 where lower(c.email) = v_email and a.starts_at >= now() and a.status in ('pending','confirmed')),
    'history', (select coalesce(jsonb_agg(private.booking_json(a.id, false) order by a.starts_at desc), '[]')
                from appointments a join clients c on c.id = a.client_id
                where lower(c.email) = v_email and (a.starts_at < now() or a.status not in ('pending','confirmed'))));
end $$;

-- Lembretes: chamado por agendador (pg_cron) com service_role.
create or replace function public.enqueue_due_reminders()
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  st public.business_settings := private.settings();
  r record;
  n int := 0;
begin
  if auth.role() <> 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  for r in select id from appointments
           where status in ('pending','confirmed')
             and starts_at between now() and now() + make_interval(hours => st.reminder_hours_before) loop
    perform private.enqueue_notifications(r.id, 'reminder');
    n := n + 1;
  end loop;
  return n;
end $$;
