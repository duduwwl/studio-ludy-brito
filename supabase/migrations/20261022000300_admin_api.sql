-- Studio Ludy Brito — API do painel administrativo
-- Todas as funções exigem um usuário autenticado presente em admin_roles.

create or replace function private.slugify(p text) returns text
language sql immutable as $$
  select trim(both '-' from regexp_replace(lower(translate(coalesce(p, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn')), '[^a-z0-9]+', '-', 'g'))
$$;

create or replace function private.unique_slug(p_table text, p_base text, p_id uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare s text := coalesce(nullif(private.slugify(p_base), ''), 'item'); candidate text := s; i int := 1; taken boolean;
begin
  loop
    execute format('select exists (select 1 from public.%I where slug = $1 and ($2 is null or id <> $2))', p_table)
      into taken using candidate, p_id;
    exit when not taken;
    i := i + 1; candidate := s || '-' || i;
  end loop;
  return candidate;
end $$;

create or replace function private.admin_appointment_json(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', a.id, 'protocol', a.protocol, 'status', a.status,
    'starts_at', a.starts_at, 'ends_at', a.ends_at, 'blocked_until', a.blocked_until,
    'duration_minutes', a.total_duration_minutes, 'total_price_cents', a.total_price_cents,
    'client_notes', a.client_notes, 'admin_notes', a.admin_notes, 'source', a.source,
    'cancel_reason', a.cancel_reason, 'cancelled_by', a.cancelled_by, 'cancelled_at', a.cancelled_at,
    'reschedule_count', a.reschedule_count, 'created_at', a.created_at,
    'professional', jsonb_build_object('id', p.id, 'name', p.name, 'color', p.color),
    'client', jsonb_build_object('id', c.id, 'name', c.full_name, 'phone', c.phone, 'email', c.email),
    'services', (select coalesce(jsonb_agg(jsonb_build_object('id', s.service_id, 'name', s.service_name,
        'duration_minutes', s.duration_minutes, 'price_cents', s.price_cents) order by s.position), '[]')
      from appointment_services s where s.appointment_id = a.id),
    'manage_url_token', private.manage_token(a.id, a.protocol))
  from appointments a join professionals p on p.id = a.professional_id join clients c on c.id = a.client_id
  where a.id = p_id
$$;

-- ---------------------------------------------------------------------------
-- Sessão
-- ---------------------------------------------------------------------------
create or replace function public.admin_me()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  perform private.require_admin();
  select ar.role, ar.display_name, ar.professional_id, u.email into r
  from admin_roles ar left join auth.users u on u.id = ar.user_id where ar.user_id = auth.uid();
  return jsonb_build_object('user_id', auth.uid(), 'role', r.role, 'name', coalesce(r.display_name, r.email),
    'email', r.email, 'professional_id', r.professional_id,
    'has_sample_services', exists (select 1 from services where is_sample and active));
end $$;

-- ---------------------------------------------------------------------------
-- Dashboard
-- ---------------------------------------------------------------------------
create or replace function public.admin_dashboard()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  tz text := private.tz();
  today date := (now() at time zone tz)::date;
  week_start date := today - ((extract(isodow from today))::int - 1);
  month_start date := date_trunc('month', today)::date;
  d0 timestamptz := today::timestamp at time zone tz;
  w0 timestamptz := week_start::timestamp at time zone tz;
  m0 timestamptz := month_start::timestamp at time zone tz;
  m1 timestamptz := (month_start + interval '1 month')::timestamp at time zone tz;
begin
  perform private.require_admin();
  return jsonb_build_object(
    'today', today,
    'counts', jsonb_build_object(
      'today', (select count(*) from appointments where status <> 'cancelled' and starts_at >= d0 and starts_at < d0 + interval '1 day'),
      'week', (select count(*) from appointments where status <> 'cancelled' and starts_at >= w0 and starts_at < w0 + interval '7 days'),
      'month', (select count(*) from appointments where status <> 'cancelled' and starts_at >= m0 and starts_at < m1),
      'pending', (select count(*) from appointments where status = 'pending' and starts_at >= now()),
      'cancelled_month', (select count(*) from appointments where status = 'cancelled' and starts_at >= m0 and starts_at < m1),
      'no_show_month', (select count(*) from appointments where status = 'no_show' and starts_at >= m0 and starts_at < m1),
      'clients', (select count(*) from clients),
      'new_clients_month', (select count(*) from clients where created_at >= m0)),
    'revenue', jsonb_build_object(
      'expected_month_cents', (select coalesce(sum(total_price_cents), 0) from appointments
                               where status in ('pending','confirmed','completed') and starts_at >= m0 and starts_at < m1),
      'realized_month_cents', (select coalesce(sum(total_price_cents), 0) from appointments
                               where status = 'completed' and starts_at >= m0 and starts_at < m1),
      'unpriced_month', (select count(*) from appointments
                         where status <> 'cancelled' and total_price_cents is null and starts_at >= m0 and starts_at < m1)),
    'next', (select coalesce(jsonb_agg(private.admin_appointment_json(id) order by starts_at), '[]') from (
               select id, starts_at from appointments
               where status in ('pending','confirmed') and ends_at >= now()
               order by starts_at limit 8) x),
    'top_services', (select coalesce(jsonb_agg(jsonb_build_object('name', service_name, 'count', n) order by n desc), '[]') from (
               select s.service_name, count(*) n from appointment_services s join appointments a on a.id = s.appointment_id
               where a.status <> 'cancelled' and a.starts_at >= now() - interval '90 days'
               group by s.service_name order by n desc limit 5) x),
    'daily', (select jsonb_agg(jsonb_build_object('date', d::date,
               'count', (select count(*) from appointments a where a.status <> 'cancelled'
                         and a.starts_at >= d::timestamp at time zone tz and a.starts_at < (d + interval '1 day')::timestamp at time zone tz))
               order by d)
              from generate_series(today - 13, today + 13, interval '1 day') d)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Agendamentos
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_appointments(
  p_from timestamptz default null, p_to timestamptz default null,
  p_statuses text[] default null, p_professional_id uuid default null,
  p_search text default null, p_order text default 'starts_at_asc',
  p_limit int default 25, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  q text := nullif(lower(trim(coalesce(p_search, ''))), '');
  digits text := nullif(regexp_replace(coalesce(p_search, ''), '\D', '', 'g'), '');
  total int;
  rows jsonb;
begin
  perform private.require_admin();
  p_limit := least(greatest(coalesce(p_limit, 25), 1), 500);

  with f as (
    select a.id, a.starts_at, c.full_name client_name, a.total_price_cents price
    from appointments a join clients c on c.id = a.client_id
    where (p_from is null or a.starts_at >= p_from)
      and (p_to is null or a.starts_at < p_to)
      and (p_statuses is null or a.status = any(p_statuses))
      and (p_professional_id is null or a.professional_id = p_professional_id)
      and (q is null or lower(c.full_name) like '%' || q || '%' or a.protocol ilike '%' || q || '%'
           or (digits is not null and length(digits) >= 4 and c.phone like '%' || digits || '%')
           or exists (select 1 from appointment_services s where s.appointment_id = a.id and lower(s.service_name) like '%' || q || '%'))),
  page as (
    select f.*, row_number() over (order by
        case when p_order = 'client' then lower(client_name) end,
        case when p_order = 'price_desc' then -coalesce(price, 0) end,
        case when p_order = 'starts_at_desc' then -extract(epoch from starts_at) else extract(epoch from starts_at) end) rn
    from f)
  select (select count(*) from f),
         (select coalesce(jsonb_agg(private.admin_appointment_json(id) order by rn), '[]')
            from page where rn > greatest(coalesce(p_offset, 0), 0) and rn <= greatest(coalesce(p_offset, 0), 0) + p_limit)
  into total, rows;
  return jsonb_build_object('total', total, 'rows', rows);
end $$;

create or replace function public.admin_get_appointment(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform private.require_admin();
  r := private.admin_appointment_json(p_id);
  if r is null then perform private.fail('NOT_FOUND', 'Agendamento não encontrado.'); end if;
  return r || jsonb_build_object('history', (select coalesce(jsonb_agg(jsonb_build_object('action', action,
      'actor_kind', actor_kind, 'details', details, 'created_at', created_at) order by created_at desc), '[]')
      from audit_logs where entity = 'appointment' and entity_id = p_id::text));
end $$;

-- Horários livres para a equipe (pode ignorar antecedência mínima/limite futuro; nunca ignora conflitos).
create or replace function public.admin_available_slots(
  p_service_ids uuid[], p_date date, p_professional_id uuid, p_exclude_appointment uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b record; tz text := private.tz();
begin
  perform private.require_admin();
  select * into b from private.service_bundle(p_service_ids, false);
  return (select coalesce(jsonb_agg(jsonb_build_object('start', t, 'time', to_char(t at time zone tz, 'HH24:MI')) order by t), '[]')
          from private.free_slots(p_professional_id, b.duration, b.buffer, p_date, p_exclude_appointment, false) t
          where t >= now() - interval '1 day');
end $$;

-- Cria/edita um agendamento pela equipe. p_id nulo = novo.
-- Se p_outside_hours = true, permite horário fora da grade (encaixe), mas a restrição de sobreposição continua valendo.
create or replace function public.admin_save_appointment(
  p_id uuid, p_service_ids uuid[], p_professional_id uuid, p_start timestamptz,
  p_client_id uuid default null, p_client_name text default null, p_client_phone text default null,
  p_client_email text default null, p_admin_notes text default null, p_status text default null,
  p_outside_hours boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  tz text := private.tz();
  b record;
  v_client uuid := p_client_id;
  v_phone text;
  v_id uuid := p_id;
  old record;
  ok boolean;
begin
  perform private.require_admin();
  select * into b from private.service_bundle(p_service_ids, false);
  if p_professional_id not in (select private.eligible_professionals(p_service_ids, false)) then
    perform private.fail('PROFESSIONAL_UNAVAILABLE', 'Essa profissional não está vinculada a todos os serviços escolhidos.');
  end if;
  if p_status is not null and p_status not in ('pending','confirmed','completed','cancelled','no_show') then
    perform private.fail('INVALID_STATUS', 'Status inválido.');
  end if;

  if v_client is null then
    v_phone := private.normalize_phone(p_client_phone);
    if length(trim(coalesce(p_client_name, ''))) < 3 then perform private.fail('INVALID_NAME', 'Informe o nome da cliente.'); end if;
    insert into clients (full_name, phone, email)
    values (trim(p_client_name), v_phone, nullif(lower(trim(coalesce(p_client_email, ''))), ''))
    on conflict (phone) do update set email = coalesce(excluded.email, clients.email)
    returning id into v_client;
  end if;

  if v_id is not null then
    select * into old from appointments where id = v_id for update;
    if not found then perform private.fail('NOT_FOUND', 'Agendamento não encontrado.'); end if;
  end if;

  if not coalesce(p_outside_hours, false) then
    select p_start in (select private.free_slots(p_professional_id, b.duration, b.buffer,
                         (p_start at time zone tz)::date, v_id, false)) into ok;
    if not ok then
      perform private.fail('SLOT_UNAVAILABLE', 'Esse horário não está livre na agenda dessa profissional. Marque "encaixe" para forçar fora da grade, se não houver conflito.');
    end if;
  end if;

  begin
    if v_id is null then
      insert into appointments (protocol, client_id, professional_id, starts_at, ends_at, blocked_until, status,
        total_price_cents, total_duration_minutes, admin_notes, source)
      values (private.new_protocol(), v_client, p_professional_id, p_start,
        p_start + make_interval(mins => b.duration), p_start + make_interval(mins => b.duration + b.buffer),
        coalesce(p_status, 'confirmed'), case when b.has_price then b.price_cents end, b.duration,
        nullif(trim(coalesce(p_admin_notes, '')), ''), 'admin')
      returning id into v_id;
      perform private.enqueue_notifications(v_id, 'created');
      perform private.audit('admin', 'appointment.created', 'appointment', v_id::text, jsonb_build_object('starts_at', p_start));
    else
      update appointments set client_id = v_client, professional_id = p_professional_id, starts_at = p_start,
        ends_at = p_start + make_interval(mins => b.duration),
        blocked_until = p_start + make_interval(mins => b.duration + b.buffer),
        total_duration_minutes = b.duration, total_price_cents = case when b.has_price then b.price_cents end,
        admin_notes = nullif(trim(coalesce(p_admin_notes, '')), ''),
        status = coalesce(p_status, status),
        reschedule_count = reschedule_count + case when old.starts_at <> p_start then 1 else 0 end
      where id = v_id;
      delete from appointment_services where appointment_id = v_id;
      if old.starts_at <> p_start or old.professional_id <> p_professional_id then
        perform private.enqueue_notifications(v_id, 'rescheduled');
      end if;
      perform private.audit('admin', 'appointment.updated', 'appointment', v_id::text,
        jsonb_build_object('from', old.starts_at, 'to', p_start, 'professional_id', p_professional_id));
    end if;
  exception when exclusion_violation then
    perform private.fail('SLOT_TAKEN', 'Conflito: já existe um atendimento nesse horário para essa profissional.');
  end;

  insert into appointment_services (appointment_id, position, service_id, service_name, duration_minutes, price_cents)
  select v_id, row_number() over (order by array_position(p_service_ids, s.id)), s.id, s.name, s.duration_minutes, s.price_cents
  from services s where s.id = any(p_service_ids);

  return private.admin_appointment_json(v_id);
end $$;

create or replace function public.admin_set_appointment_status(p_id uuid, p_status text, p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare old record;
begin
  perform private.require_admin();
  if p_status not in ('pending','confirmed','completed','cancelled','no_show') then
    perform private.fail('INVALID_STATUS', 'Status inválido.');
  end if;
  select * into old from appointments where id = p_id for update;
  if not found then perform private.fail('NOT_FOUND', 'Agendamento não encontrado.'); end if;
  if old.status = 'cancelled' and p_status <> 'cancelled' then
    begin
      update appointments set status = p_status, cancelled_at = null, cancelled_by = null, cancel_reason = null where id = p_id;
    exception when exclusion_violation then
      perform private.fail('SLOT_TAKEN', 'Não é possível reativar: o horário já foi ocupado por outro atendimento.');
    end;
  else
    update appointments set status = p_status,
      cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end,
      cancelled_by = case when p_status = 'cancelled' then 'admin' else cancelled_by end,
      cancel_reason = case when p_status = 'cancelled' then left(nullif(trim(coalesce(p_reason, '')), ''), 300) else cancel_reason end
    where id = p_id;
  end if;
  if p_status in ('confirmed','cancelled') and old.status <> p_status then
    perform private.enqueue_notifications(p_id, p_status);
  end if;
  perform private.audit('admin', 'appointment.status', 'appointment', p_id::text,
    jsonb_build_object('from', old.status, 'to', p_status, 'reason', p_reason));
  return private.admin_appointment_json(p_id);
end $$;

create or replace function public.admin_set_appointment_notes(p_id uuid, p_notes text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  perform private.require_admin();
  update appointments set admin_notes = nullif(trim(coalesce(p_notes, '')), '') where id = p_id;
  if not found then perform private.fail('NOT_FOUND', 'Agendamento não encontrado.'); end if;
  perform private.audit('admin', 'appointment.notes', 'appointment', p_id::text, null);
  return private.admin_appointment_json(p_id);
end $$;

-- ---------------------------------------------------------------------------
-- Clientes
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_clients(p_search text default null, p_filter text default null,
  p_limit int default 25, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  q text := nullif(lower(trim(coalesce(p_search, ''))), '');
  digits text := nullif(regexp_replace(coalesce(p_search, ''), '\D', '', 'g'), '');
begin
  perform private.require_admin();
  p_limit := least(greatest(coalesce(p_limit, 25), 1), 500);
  return (with base as (
      select c.*,
        (select count(*) from appointments a where a.client_id = c.id and a.status <> 'cancelled') visits,
        (select max(a.starts_at) from appointments a where a.client_id = c.id and a.status = 'completed') last_visit,
        (select min(a.starts_at) from appointments a where a.client_id = c.id and a.status in ('pending','confirmed') and a.starts_at >= now()) next_visit
      from clients c
      where (q is null or lower(c.full_name) like '%' || q || '%' or lower(coalesce(c.email, '')) like '%' || q || '%'
             or (digits is not null and length(digits) >= 4 and c.phone like '%' || digits || '%'))),
    filtered as (
      select * from base where p_filter is null
        or (p_filter = 'recurring' and visits >= 2)
        or (p_filter = 'upcoming' and next_visit is not null)
        or (p_filter = 'inactive' and (last_visit is null or last_visit < now() - interval '90 days') and next_visit is null))
    select jsonb_build_object('total', (select count(*) from filtered),
      'rows', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', full_name, 'phone', phone, 'email', email,
          'visits', visits, 'last_visit', last_visit, 'next_visit', next_visit, 'created_at', created_at) order by lower(full_name)), '[]')
        from (select * from filtered order by lower(full_name) limit p_limit offset greatest(coalesce(p_offset, 0), 0)) x)));
end $$;

create or replace function public.admin_get_client(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform private.require_admin();
  select jsonb_build_object('id', c.id, 'name', c.full_name, 'phone', c.phone, 'email', c.email,
    'admin_notes', c.admin_notes, 'created_at', c.created_at, 'privacy_consent_at', c.privacy_consent_at,
    'appointments', (select coalesce(jsonb_agg(private.admin_appointment_json(a.id) order by a.starts_at desc), '[]')
                     from appointments a where a.client_id = c.id))
  into r from clients c where c.id = p_id;
  if r is null then perform private.fail('NOT_FOUND', 'Cliente não encontrada.'); end if;
  perform private.audit('admin', 'client.viewed', 'client', p_id::text, null);
  return r;
end $$;

create or replace function public.admin_save_client(p_id uuid, p_name text, p_phone text, p_email text, p_admin_notes text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid := p_id;
begin
  perform private.require_admin();
  if length(trim(coalesce(p_name, ''))) < 3 then perform private.fail('INVALID_NAME', 'Informe o nome completo.'); end if;
  if nullif(trim(coalesce(p_email, '')), '') is not null and trim(p_email) !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    perform private.fail('INVALID_EMAIL', 'Confira o e-mail informado.');
  end if;
  begin
    if v_id is null then
      insert into clients (full_name, phone, email, admin_notes)
      values (trim(p_name), private.normalize_phone(p_phone), nullif(lower(trim(coalesce(p_email, ''))), ''), nullif(trim(coalesce(p_admin_notes, '')), ''))
      returning id into v_id;
    else
      update clients set full_name = trim(p_name), phone = private.normalize_phone(p_phone),
        email = nullif(lower(trim(coalesce(p_email, ''))), ''), admin_notes = nullif(trim(coalesce(p_admin_notes, '')), '')
      where id = v_id;
    end if;
  exception when unique_violation then
    perform private.fail('PHONE_IN_USE', 'Já existe uma cliente com esse WhatsApp.');
  end;
  perform private.audit('admin', 'client.saved', 'client', v_id::text, null);
  return public.admin_get_client(v_id);
end $$;

-- ---------------------------------------------------------------------------
-- Serviços e categorias
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_catalog()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'categories', (select coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object(
        'service_count', (select count(*) from services s where s.category_id = c.id)) order by c.sort_order, c.name), '[]')
      from service_categories c),
    'services', (select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object(
        'professional_ids', (select coalesce(jsonb_agg(ps.professional_id), '[]') from professional_services ps where ps.service_id = s.id),
        'appointment_count', (select count(*) from appointment_services x where x.service_id = s.id)) order by s.sort_order, s.name), '[]')
      from services s),
    'professionals', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'active', active) order by sort_order, name), '[]')
      from professionals));
end $$;

create or replace function public.admin_save_category(p_id uuid, p_name text, p_description text default null, p_sort_order int default 0)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid := p_id;
begin
  perform private.require_admin(array['owner','manager']);
  if length(trim(coalesce(p_name, ''))) < 2 then perform private.fail('INVALID_NAME', 'Informe o nome da categoria.'); end if;
  if v_id is null then
    insert into service_categories (name, slug, description, sort_order)
    values (trim(p_name), private.unique_slug('service_categories', p_name, null), p_description, coalesce(p_sort_order, 0))
    returning id into v_id;
  else
    update service_categories set name = trim(p_name), description = p_description, sort_order = coalesce(p_sort_order, 0),
      slug = private.unique_slug('service_categories', p_name, v_id) where id = v_id;
  end if;
  perform private.audit('admin', 'category.saved', 'service_category', v_id::text, null);
  return (select to_jsonb(c) from service_categories c where id = v_id);
end $$;

create or replace function public.admin_delete_category(p_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform private.require_admin(array['owner','manager']);
  delete from service_categories where id = p_id;
  perform private.audit('admin', 'category.deleted', 'service_category', p_id::text, null);
end $$;

-- p jsonb: {id?, name, category_id, summary, description, duration_minutes, buffer_after_minutes, price_cents,
--           price_is_starting, image_path, image_alt, active, bookable_online, combinable, sort_order, professional_ids[]}
create or replace function public.admin_save_service(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_name text := trim(coalesce(p ->> 'name', ''));
  v_dur int := (p ->> 'duration_minutes')::int;
begin
  perform private.require_admin(array['owner','manager']);
  if length(v_name) < 2 then perform private.fail('INVALID_NAME', 'Informe o nome do serviço.'); end if;
  if v_dur is null or v_dur not between 5 and 600 then perform private.fail('INVALID_DURATION', 'A duração deve ficar entre 5 e 600 minutos.'); end if;
  if (p ->> 'price_cents') is not null and (p ->> 'price_cents')::int < 0 then perform private.fail('INVALID_PRICE', 'Preço inválido.'); end if;

  if v_id is null then
    insert into services (name, slug, category_id, summary, description, duration_minutes, buffer_after_minutes, price_cents,
      price_is_starting, image_path, image_alt, active, bookable_online, combinable, sort_order, is_sample)
    values (v_name, private.unique_slug('services', v_name, null), nullif(p ->> 'category_id', '')::uuid,
      nullif(trim(p ->> 'summary'), ''), nullif(trim(p ->> 'description'), ''), v_dur,
      nullif(p ->> 'buffer_after_minutes', '')::int, nullif(p ->> 'price_cents', '')::int,
      coalesce((p ->> 'price_is_starting')::boolean, false), nullif(p ->> 'image_path', ''), nullif(p ->> 'image_alt', ''),
      coalesce((p ->> 'active')::boolean, true), coalesce((p ->> 'bookable_online')::boolean, true),
      coalesce((p ->> 'combinable')::boolean, true), coalesce((p ->> 'sort_order')::int, 0), false)
    returning id into v_id;
  else
    update services set name = v_name, slug = private.unique_slug('services', v_name, v_id),
      category_id = nullif(p ->> 'category_id', '')::uuid,
      summary = nullif(trim(p ->> 'summary'), ''), description = nullif(trim(p ->> 'description'), ''),
      duration_minutes = v_dur, buffer_after_minutes = nullif(p ->> 'buffer_after_minutes', '')::int,
      price_cents = nullif(p ->> 'price_cents', '')::int, price_is_starting = coalesce((p ->> 'price_is_starting')::boolean, false),
      image_path = nullif(p ->> 'image_path', ''), image_alt = nullif(p ->> 'image_alt', ''),
      active = coalesce((p ->> 'active')::boolean, true), bookable_online = coalesce((p ->> 'bookable_online')::boolean, true),
      combinable = coalesce((p ->> 'combinable')::boolean, true), sort_order = coalesce((p ->> 'sort_order')::int, 0),
      is_sample = false
    where id = v_id;
    if not found then perform private.fail('NOT_FOUND', 'Serviço não encontrado.'); end if;
  end if;

  if p ? 'professional_ids' then
    delete from professional_services where service_id = v_id;
    insert into professional_services (professional_id, service_id)
    select x::uuid, v_id from jsonb_array_elements_text(p -> 'professional_ids') x
    on conflict do nothing;
  end if;
  perform private.audit('admin', 'service.saved', 'service', v_id::text, p - 'description');
  return (select to_jsonb(s) from services s where id = v_id);
end $$;

create or replace function public.admin_delete_service(p_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform private.require_admin(array['owner','manager']);
  if exists (select 1 from appointment_services where service_id = p_id) then
    perform private.fail('SERVICE_IN_USE', 'Este serviço já tem agendamentos no histórico. Desative-o em vez de excluir.');
  end if;
  delete from services where id = p_id;
  perform private.audit('admin', 'service.deleted', 'service', p_id::text, null);
end $$;

-- ---------------------------------------------------------------------------
-- Profissionais e horários
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_professionals()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return (select coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object(
      'service_ids', (select coalesce(jsonb_agg(service_id), '[]') from professional_services where professional_id = p.id),
      'schedule', (select coalesce(jsonb_agg(jsonb_build_object('weekday', weekday, 'start', to_char(start_time, 'HH24:MI'),
                    'end', to_char(end_time, 'HH24:MI')) order by weekday, start_time), '[]')
                   from professional_schedules where professional_id = p.id)) order by p.sort_order, p.name), '[]')
    from professionals p);
end $$;

-- p: {id?, name, bio, photo_path, color, active, accepts_online_booking, sort_order, service_ids[], schedule[{weekday,start,end}] | null}
create or replace function public.admin_save_professional(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_name text := trim(coalesce(p ->> 'name', ''));
begin
  perform private.require_admin(array['owner','manager']);
  if length(v_name) < 2 then perform private.fail('INVALID_NAME', 'Informe o nome da profissional.'); end if;
  if v_id is null then
    insert into professionals (name, slug, bio, photo_path, color, active, accepts_online_booking, sort_order)
    values (v_name, private.unique_slug('professionals', v_name, null), nullif(trim(p ->> 'bio'), ''), nullif(p ->> 'photo_path', ''),
      coalesce(nullif(p ->> 'color', ''), '#8a5a3c'), coalesce((p ->> 'active')::boolean, true),
      coalesce((p ->> 'accepts_online_booking')::boolean, true), coalesce((p ->> 'sort_order')::int, 0))
    returning id into v_id;
  else
    update professionals set name = v_name, slug = private.unique_slug('professionals', v_name, v_id),
      bio = nullif(trim(p ->> 'bio'), ''), photo_path = nullif(p ->> 'photo_path', ''),
      color = coalesce(nullif(p ->> 'color', ''), color), active = coalesce((p ->> 'active')::boolean, true),
      accepts_online_booking = coalesce((p ->> 'accepts_online_booking')::boolean, true),
      sort_order = coalesce((p ->> 'sort_order')::int, 0)
    where id = v_id;
    if not found then perform private.fail('NOT_FOUND', 'Profissional não encontrada.'); end if;
  end if;
  if p ? 'service_ids' then
    delete from professional_services where professional_id = v_id;
    insert into professional_services (professional_id, service_id)
    select v_id, x::uuid from jsonb_array_elements_text(p -> 'service_ids') x on conflict do nothing;
  end if;
  if p ? 'schedule' then
    delete from professional_schedules where professional_id = v_id;
    if jsonb_typeof(p -> 'schedule') = 'array' then
      insert into professional_schedules (professional_id, weekday, start_time, end_time)
      select v_id, (x ->> 'weekday')::smallint, (x ->> 'start')::time, (x ->> 'end')::time
      from jsonb_array_elements(p -> 'schedule') x;
    end if;
  end if;
  perform private.audit('admin', 'professional.saved', 'professional', v_id::text, null);
  return (select x from jsonb_array_elements(public.admin_list_professionals()) x where x ->> 'id' = v_id::text);
end $$;

create or replace function public.admin_get_availability_config()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tz text := private.tz();
begin
  perform private.require_admin();
  return jsonb_build_object(
    'business_hours', (select coalesce(jsonb_agg(jsonb_build_object('weekday', weekday, 'start', to_char(start_time, 'HH24:MI'),
        'end', to_char(end_time, 'HH24:MI')) order by weekday, start_time), '[]') from business_hours),
    'exceptions', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'professional_id', e.professional_id,
        'professional_name', p.name, 'date', e.date, 'kind', e.kind, 'start', to_char(e.start_time, 'HH24:MI'),
        'end', to_char(e.end_time, 'HH24:MI'), 'reason', e.reason) order by e.date), '[]')
      from schedule_exceptions e left join professionals p on p.id = e.professional_id
      where e.date >= (now() at time zone tz)::date - 30),
    'blocks', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'professional_id', b.professional_id,
        'professional_name', p.name, 'starts_at', b.starts_at, 'ends_at', b.ends_at, 'kind', b.kind, 'reason', b.reason)
        order by b.starts_at), '[]')
      from blocked_periods b left join professionals p on p.id = b.professional_id
      where b.ends_at >= now() - interval '30 days'),
    'rules', (select jsonb_build_object('slot_step_minutes', slot_step_minutes, 'min_advance_minutes', min_advance_minutes,
        'max_advance_days', max_advance_days, 'default_buffer_minutes', default_buffer_minutes,
        'cancel_min_hours', cancel_min_hours, 'reschedule_min_hours', reschedule_min_hours, 'auto_confirm', auto_confirm,
        'allow_multiple_services', allow_multiple_services, 'max_services_per_booking', max_services_per_booking)
      from business_settings where id = 1));
end $$;

-- p: [{weekday, start, end}, ...] — substitui a grade semanal do studio
create or replace function public.admin_save_business_hours(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  perform private.require_admin(array['owner','manager']);
  if jsonb_typeof(p) <> 'array' then perform private.fail('INVALID_REQUEST', 'Formato inválido.'); end if;
  if exists (
    select 1 from jsonb_array_elements(p) a, jsonb_array_elements(p) b
    where a <> b and a ->> 'weekday' = b ->> 'weekday'
      and (a ->> 'start')::time < (b ->> 'end')::time and (b ->> 'start')::time < (a ->> 'end')::time) then
    perform private.fail('OVERLAPPING_HOURS', 'Há intervalos sobrepostos no mesmo dia.');
  end if;
  delete from business_hours where true;
  insert into business_hours (weekday, start_time, end_time)
  select (x ->> 'weekday')::smallint, (x ->> 'start')::time, (x ->> 'end')::time from jsonb_array_elements(p) x;
  perform private.audit('admin', 'business_hours.saved', 'business_hours', null, p);
  return public.admin_get_availability_config();
end $$;

create or replace function public.admin_save_rules(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  perform private.require_admin(array['owner','manager']);
  update business_settings set
    slot_step_minutes = coalesce((p ->> 'slot_step_minutes')::int, slot_step_minutes),
    min_advance_minutes = coalesce((p ->> 'min_advance_minutes')::int, min_advance_minutes),
    max_advance_days = coalesce((p ->> 'max_advance_days')::int, max_advance_days),
    default_buffer_minutes = coalesce((p ->> 'default_buffer_minutes')::int, default_buffer_minutes),
    cancel_min_hours = coalesce((p ->> 'cancel_min_hours')::int, cancel_min_hours),
    reschedule_min_hours = coalesce((p ->> 'reschedule_min_hours')::int, reschedule_min_hours),
    auto_confirm = coalesce((p ->> 'auto_confirm')::boolean, auto_confirm),
    allow_multiple_services = coalesce((p ->> 'allow_multiple_services')::boolean, allow_multiple_services),
    max_services_per_booking = coalesce((p ->> 'max_services_per_booking')::int, max_services_per_booking)
  where id = 1;
  perform private.audit('admin', 'rules.saved', 'business_settings', '1', p);
  return public.admin_get_availability_config();
end $$;

create or replace function public.admin_save_exception(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid;
begin
  perform private.require_admin(array['owner','manager']);
  begin
    insert into schedule_exceptions (professional_id, date, kind, start_time, end_time, reason)
    values (nullif(p ->> 'professional_id', '')::uuid, (p ->> 'date')::date, p ->> 'kind',
      nullif(p ->> 'start', '')::time, nullif(p ->> 'end', '')::time, nullif(trim(p ->> 'reason'), ''))
    returning id into v_id;
  exception when unique_violation then
    perform private.fail('DUPLICATE', 'Já existe uma exceção igual para essa data.');
  when check_violation then
    perform private.fail('INVALID_HOURS', 'Informe início e fim válidos para o horário especial.');
  end;
  perform private.audit('admin', 'exception.created', 'schedule_exception', v_id::text, p);
  return public.admin_get_availability_config();
end $$;

create or replace function public.admin_delete_exception(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  perform private.require_admin(array['owner','manager']);
  delete from schedule_exceptions where id = p_id;
  perform private.audit('admin', 'exception.deleted', 'schedule_exception', p_id::text, null);
  return public.admin_get_availability_config();
end $$;

-- Bloqueio: horário, intervalo, dia inteiro, vários dias ou férias. Retorna também os atendimentos já marcados no período.
create or replace function public.admin_create_block(p_professional_id uuid, p_starts_at timestamptz, p_ends_at timestamptz,
  p_kind text default 'block', p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid;
begin
  perform private.require_admin();
  if p_ends_at <= p_starts_at then perform private.fail('INVALID_RANGE', 'O fim do bloqueio precisa ser depois do início.'); end if;
  if p_kind not in ('block','vacation','day_off','break') then perform private.fail('INVALID_KIND', 'Tipo de bloqueio inválido.'); end if;
  insert into blocked_periods (professional_id, starts_at, ends_at, kind, reason, created_by)
  values (p_professional_id, p_starts_at, p_ends_at, p_kind, nullif(trim(coalesce(p_reason, '')), ''), auth.uid())
  returning id into v_id;
  perform private.audit('admin', 'block.created', 'blocked_period', v_id::text,
    jsonb_build_object('starts_at', p_starts_at, 'ends_at', p_ends_at, 'professional_id', p_professional_id, 'kind', p_kind));
  return jsonb_build_object('id', v_id,
    'conflicts', (select coalesce(jsonb_agg(private.admin_appointment_json(a.id) order by a.starts_at), '[]') from appointments a
                  where a.status in ('pending','confirmed')
                    and (p_professional_id is null or a.professional_id = p_professional_id)
                    and tstzrange(a.starts_at, a.ends_at) && tstzrange(p_starts_at, p_ends_at)));
end $$;

create or replace function public.admin_delete_block(p_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform private.require_admin();
  delete from blocked_periods where id = p_id;
  perform private.audit('admin', 'block.deleted', 'blocked_period', p_id::text, null);
end $$;

-- Agenda visual: atendimentos + bloqueios + grade de trabalho num intervalo de datas
create or replace function public.admin_calendar(p_from date, p_to date, p_professional_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tz text := private.tz(); f timestamptz; t timestamptz;
begin
  perform private.require_admin();
  if p_to < p_from or p_to - p_from > 62 then perform private.fail('INVALID_RANGE', 'Intervalo inválido.'); end if;
  f := p_from::timestamp at time zone tz; t := (p_to + 1)::timestamp at time zone tz;
  return jsonb_build_object(
    'appointments', (select coalesce(jsonb_agg(private.admin_appointment_json(a.id) order by a.starts_at), '[]') from appointments a
      where a.starts_at < t and a.ends_at > f and (p_professional_id is null or a.professional_id = p_professional_id)),
    'blocks', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'professional_id', b.professional_id, 'starts_at', b.starts_at,
        'ends_at', b.ends_at, 'kind', b.kind, 'reason', b.reason) order by b.starts_at), '[]') from blocked_periods b
      where b.starts_at < t and b.ends_at > f and (p_professional_id is null or b.professional_id is null or b.professional_id = p_professional_id)),
    'hours', (select coalesce(jsonb_agg(jsonb_build_object('date', d::date, 'professional_id', p.id,
        'intervals', (select coalesce(jsonb_agg(jsonb_build_object('start', w.starts_at, 'end', w.ends_at)), '[]')
                      from private.work_intervals(p.id, d::date) w)) order by d, p.sort_order), '[]')
      from generate_series(p_from, p_to, interval '1 day') d, professionals p
      where p.active and (p_professional_id is null or p.id = p_professional_id)),
    'professionals', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'color', color) order by sort_order, name), '[]')
      from professionals where active));
end $$;

-- ---------------------------------------------------------------------------
-- Relatórios
-- ---------------------------------------------------------------------------
create or replace function public.admin_reports(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tz text := private.tz(); f timestamptz; t timestamptz;
begin
  perform private.require_admin(array['owner','manager']);
  if p_to < p_from or p_to - p_from > 731 then perform private.fail('INVALID_RANGE', 'Intervalo inválido (máx. 2 anos).'); end if;
  f := p_from::timestamp at time zone tz; t := (p_to + 1)::timestamp at time zone tz;
  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'totals', (select jsonb_build_object(
        'total', count(*),
        'pending', count(*) filter (where status = 'pending'),
        'confirmed', count(*) filter (where status = 'confirmed'),
        'completed', count(*) filter (where status = 'completed'),
        'cancelled', count(*) filter (where status = 'cancelled'),
        'no_show', count(*) filter (where status = 'no_show'),
        'cancelled_by_client', count(*) filter (where status = 'cancelled' and cancelled_by = 'client'),
        'expected_cents', coalesce(sum(total_price_cents) filter (where status in ('pending','confirmed','completed')), 0),
        'realized_cents', coalesce(sum(total_price_cents) filter (where status = 'completed'), 0),
        'online', count(*) filter (where source = 'online'))
      from appointments where starts_at >= f and starts_at < t),
    'by_service', (select coalesce(jsonb_agg(x order by (x ->> 'count')::int desc), '[]') from (
        select jsonb_build_object('name', s.service_name, 'count', count(*),
          'revenue_cents', coalesce(sum(s.price_cents) filter (where a.status = 'completed'), 0)) x
        from appointment_services s join appointments a on a.id = s.appointment_id
        where a.starts_at >= f and a.starts_at < t and a.status <> 'cancelled' group by s.service_name) y),
    'by_weekday_hour', (select coalesce(jsonb_agg(jsonb_build_object('weekday', wd, 'hour', hr, 'count', n)), '[]') from (
        select extract(dow from starts_at at time zone tz)::int wd, extract(hour from starts_at at time zone tz)::int hr, count(*) n
        from appointments where starts_at >= f and starts_at < t and status <> 'cancelled' group by 1, 2) z),
    'by_day', (select coalesce(jsonb_agg(jsonb_build_object('date', d::date,
        'count', (select count(*) from appointments a where a.status <> 'cancelled'
                  and a.starts_at >= d::timestamp at time zone tz and a.starts_at < (d + interval '1 day')::timestamp at time zone tz),
        'cancelled', (select count(*) from appointments a where a.status = 'cancelled'
                  and a.starts_at >= d::timestamp at time zone tz and a.starts_at < (d + interval '1 day')::timestamp at time zone tz))
        order by d), '[]') from generate_series(p_from, p_to, interval '1 day') d),
    'recurring_clients', (select coalesce(jsonb_agg(x order by (x ->> 'visits')::int desc), '[]') from (
        select jsonb_build_object('id', c.id, 'name', c.full_name, 'phone', c.phone, 'visits', count(*)) x
        from appointments a join clients c on c.id = a.client_id
        where a.starts_at >= f and a.starts_at < t and a.status in ('completed','confirmed','pending')
        group by c.id having count(*) >= 2 order by count(*) desc limit 20) y));
end $$;

-- Linhas para exportação CSV (o painel monta o arquivo).
create or replace function public.admin_export_appointments(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tz text := private.tz();
begin
  perform private.require_admin(array['owner','manager']);
  perform private.audit('admin', 'report.exported', 'appointment', null, jsonb_build_object('from', p_from, 'to', p_to));
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'protocolo', a.protocol,
      'data', to_char(a.starts_at at time zone tz, 'DD/MM/YYYY'),
      'horario', to_char(a.starts_at at time zone tz, 'HH24:MI'),
      'duracao_min', a.total_duration_minutes,
      'cliente', c.full_name, 'whatsapp', c.phone, 'email', c.email,
      'servicos', (select string_agg(s.service_name, ' + ' order by s.position) from appointment_services s where s.appointment_id = a.id),
      'profissional', p.name,
      'valor', case when a.total_price_cents is null then null else round(a.total_price_cents / 100.0, 2) end,
      'status', a.status, 'origem', a.source) order by a.starts_at), '[]')
    from appointments a join clients c on c.id = a.client_id join professionals p on p.id = a.professional_id
    where a.starts_at >= p_from::timestamp at time zone tz and a.starts_at < (p_to + 1)::timestamp at time zone tz);
end $$;

-- ---------------------------------------------------------------------------
-- Configurações e equipe administrativa
-- ---------------------------------------------------------------------------
create or replace function public.admin_get_settings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return (select to_jsonb(s) from business_settings s where id = 1) || jsonb_build_object(
    'admins', (select coalesce(jsonb_agg(jsonb_build_object('user_id', ar.user_id, 'email', u.email, 'role', ar.role,
        'display_name', ar.display_name) order by ar.created_at), '[]')
      from admin_roles ar left join auth.users u on u.id = ar.user_id),
    'notification_stats', (select coalesce(jsonb_object_agg(status, n), '{}') from (
        select status, count(*) n from notifications where created_at > now() - interval '30 days' group by status) x));
end $$;

create or replace function public.admin_save_settings(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  perform private.require_admin(array['owner']);
  if (p ->> 'whatsapp') is not null and regexp_replace(p ->> 'whatsapp', '\D', '', 'g') !~ '^55[1-9][0-9]9?[0-9]{8}$' then
    perform private.fail('INVALID_PHONE', 'WhatsApp inválido. Use DDI + DDD + número.');
  end if;
  update business_settings set
    trade_name = coalesce(nullif(trim(p ->> 'trade_name'), ''), trade_name),
    tagline = coalesce(p ->> 'tagline', tagline),
    about = coalesce(p ->> 'about', about),
    address_line = coalesce(p ->> 'address_line', address_line),
    neighborhood = coalesce(p ->> 'neighborhood', neighborhood),
    city = coalesce(p ->> 'city', city), state = coalesce(p ->> 'state', state),
    postal_code = coalesce(p ->> 'postal_code', postal_code),
    latitude = coalesce(nullif(p ->> 'latitude', '')::numeric, latitude),
    longitude = coalesce(nullif(p ->> 'longitude', '')::numeric, longitude),
    maps_url = coalesce(p ->> 'maps_url', maps_url),
    whatsapp = coalesce(regexp_replace(p ->> 'whatsapp', '\D', '', 'g'), whatsapp),
    instagram = coalesce(trim(both '@ ' from p ->> 'instagram'), instagram),
    email = coalesce(nullif(trim(p ->> 'email'), ''), email),
    logo_path = coalesce(p ->> 'logo_path', logo_path),
    booking_policy = coalesce(p ->> 'booking_policy', booking_policy),
    cancellation_policy = coalesce(p ->> 'cancellation_policy', cancellation_policy),
    privacy_contact = coalesce(p ->> 'privacy_contact', privacy_contact),
    notify_owner_email = case when p ? 'notify_owner_email' then nullif(trim(p ->> 'notify_owner_email'), '') else notify_owner_email end,
    notify_email_enabled = coalesce((p ->> 'notify_email_enabled')::boolean, notify_email_enabled),
    notify_whatsapp_enabled = coalesce((p ->> 'notify_whatsapp_enabled')::boolean, notify_whatsapp_enabled),
    reminder_hours_before = coalesce((p ->> 'reminder_hours_before')::int, reminder_hours_before)
  where id = 1;
  perform private.audit('admin', 'settings.saved', 'business_settings', '1', p - 'about');
  return public.admin_get_settings();
end $$;

-- Concede acesso ao painel para um usuário já convidado no Supabase Auth.
create or replace function public.admin_grant_access(p_email text, p_role text, p_display_name text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare uid uuid;
begin
  perform private.require_admin(array['owner']);
  if p_role not in ('owner','manager','staff') then perform private.fail('INVALID_ROLE', 'Perfil inválido.'); end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then
    perform private.fail('USER_NOT_FOUND', 'Convide primeiro esse e-mail em Authentication → Users no Supabase.');
  end if;
  insert into admin_roles (user_id, role, display_name) values (uid, p_role, nullif(trim(coalesce(p_display_name, '')), ''))
  on conflict (user_id) do update set role = excluded.role, display_name = excluded.display_name;
  perform private.audit('admin', 'admin.granted', 'admin_roles', uid::text, jsonb_build_object('role', p_role));
  return public.admin_get_settings();
end $$;

create or replace function public.admin_revoke_access(p_user_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  perform private.require_admin(array['owner']);
  if p_user_id = auth.uid() then perform private.fail('CANNOT_REVOKE_SELF', 'Você não pode remover o próprio acesso.'); end if;
  delete from admin_roles where user_id = p_user_id;
  perform private.audit('admin', 'admin.revoked', 'admin_roles', p_user_id::text, null);
  return public.admin_get_settings();
end $$;

create or replace function public.admin_audit_log(p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin(array['owner']);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'actor', coalesce(ar.display_name, u.email, l.actor_kind),
      'actor_kind', l.actor_kind, 'action', l.action, 'entity', l.entity, 'entity_id', l.entity_id, 'created_at', l.created_at)
      order by l.created_at desc), '[]')
    from (select * from audit_logs order by created_at desc limit least(coalesce(p_limit, 50), 200) offset greatest(coalesce(p_offset, 0), 0)) l
    left join admin_roles ar on ar.user_id = l.actor_id left join auth.users u on u.id = l.actor_id);
end $$;

-- ---------------------------------------------------------------------------
-- Permissões de execução: nada é público por padrão.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

-- O schema private não é exposto: funções internas só rodam dentro das funções security definer (como owner).

grant execute on function public.get_public_site() to anon, authenticated;
grant execute on function public.get_availability_calendar(uuid[], uuid, date) to anon, authenticated;
grant execute on function public.get_available_slots(uuid[], date, uuid, text, text) to anon, authenticated;
grant execute on function public.create_booking(uuid[], timestamptz, text, text, uuid, text, text, boolean, boolean, text) to anon, authenticated;
grant execute on function public.get_booking(text, text) to anon, authenticated;
grant execute on function public.cancel_booking(text, text, text) to anon, authenticated;
grant execute on function public.reschedule_booking(text, text, timestamptz, uuid) to anon, authenticated;
grant execute on function public.my_appointments() to authenticated;
grant execute on function public.enqueue_due_reminders() to service_role;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'admin\_%' loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
