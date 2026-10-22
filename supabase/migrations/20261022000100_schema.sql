-- Studio Ludy Brito — estrutura do banco
-- Fuso padrão de negócio: America/Sao_Paulo. Todos os instantes são timestamptz.

create extension if not exists btree_gist with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- Segredos internos (nunca expostos à API)
-- ---------------------------------------------------------------------------
create table private.app_secrets (
  name text primary key,
  value text not null
);
insert into private.app_secrets (name, value)
values ('manage_token_key', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Configurações do estabelecimento (linha única)
-- ---------------------------------------------------------------------------
create table public.business_settings (
  id smallint primary key default 1 check (id = 1),
  trade_name text not null,
  legal_name text,
  tagline text,
  about text,
  address_line text,
  neighborhood text,
  city text,
  state text,
  postal_code text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  maps_url text,
  whatsapp text,                          -- somente dígitos, com DDI: 5535991260502
  instagram text,                         -- usuário, sem @
  email text,
  logo_path text,
  timezone text not null default 'America/Sao_Paulo',
  slot_step_minutes int not null default 30 check (slot_step_minutes between 5 and 120),
  min_advance_minutes int not null default 120 check (min_advance_minutes >= 0),
  max_advance_days int not null default 60 check (max_advance_days between 1 and 365),
  default_buffer_minutes int not null default 10 check (default_buffer_minutes between 0 and 120),
  cancel_min_hours int not null default 12 check (cancel_min_hours >= 0),
  reschedule_min_hours int not null default 12 check (reschedule_min_hours >= 0),
  auto_confirm boolean not null default false,
  allow_multiple_services boolean not null default true,
  max_services_per_booking int not null default 3 check (max_services_per_booking between 1 and 6),
  booking_policy text,
  cancellation_policy text,
  privacy_contact text,
  notify_owner_email text,
  notify_email_enabled boolean not null default false,
  notify_whatsapp_enabled boolean not null default false,
  reminder_hours_before int not null default 24 check (reminder_hours_before between 1 and 168),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Equipe e permissões
-- ---------------------------------------------------------------------------
create table public.professionals (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 80),
  slug text not null unique,
  bio text,
  photo_path text,
  color text not null default '#8a5a3c',
  active boolean not null default true,
  accepts_online_booking boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.admin_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'staff')),
  professional_id uuid references public.professionals(id) on delete set null,
  display_name text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------------
create table public.service_categories (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 60),
  slug text not null unique,
  description text,
  sort_order int not null default 0
);

create table public.services (
  id uuid primary key default extensions.gen_random_uuid(),
  category_id uuid references public.service_categories(id) on delete set null,
  name text not null check (length(trim(name)) between 2 and 80),
  slug text not null unique,
  summary text,
  description text,
  duration_minutes int not null check (duration_minutes between 5 and 600),
  buffer_after_minutes int check (buffer_after_minutes between 0 and 120), -- null = padrão do studio
  price_cents int check (price_cents >= 0),                                -- null = sob consulta
  price_is_starting boolean not null default false,
  image_path text,
  image_alt text,
  active boolean not null default true,
  bookable_online boolean not null default true,
  combinable boolean not null default true,
  is_sample boolean not null default false,   -- dado de exemplo, a confirmar com o studio
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.professional_services (
  professional_id uuid not null references public.professionals(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  primary key (professional_id, service_id)
);

-- ---------------------------------------------------------------------------
-- Disponibilidade
-- ---------------------------------------------------------------------------
-- Horário do studio: intervalos por dia da semana (0 = domingo). Almoço = intervalo entre duas linhas.
create table public.business_hours (
  id uuid primary key default extensions.gen_random_uuid(),
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  check (end_time > start_time)
);

-- Horário de cada profissional. Se a profissional não tiver nenhuma linha, segue o horário do studio.
create table public.professional_schedules (
  id uuid primary key default extensions.gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  check (end_time > start_time)
);

-- Exceções por data: feriado / dia fechado / horário especial. professional_id nulo = studio inteiro.
create table public.schedule_exceptions (
  id uuid primary key default extensions.gen_random_uuid(),
  professional_id uuid references public.professionals(id) on delete cascade,
  date date not null,
  kind text not null check (kind in ('closed', 'holiday', 'custom_hours')),
  start_time time,
  end_time time,
  reason text,
  created_at timestamptz not null default now(),
  check (kind <> 'custom_hours' or (start_time is not null and end_time is not null and end_time > start_time))
);
create unique index schedule_exceptions_unique
  on public.schedule_exceptions (coalesce(professional_id, '00000000-0000-0000-0000-000000000000'::uuid), date, kind, coalesce(start_time, '00:00'));

-- Bloqueios por período (horário, intervalo, dia, vários dias, férias, folga).
create table public.blocked_periods (
  id uuid primary key default extensions.gen_random_uuid(),
  professional_id uuid references public.professionals(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  kind text not null default 'block' check (kind in ('block', 'vacation', 'day_off', 'break')),
  reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index blocked_periods_range on public.blocked_periods using gist (professional_id, tstzrange(starts_at, ends_at));

-- ---------------------------------------------------------------------------
-- Clientes e agendamentos
-- ---------------------------------------------------------------------------
create table public.clients (
  id uuid primary key default extensions.gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) between 3 and 120),
  phone text not null unique check (phone ~ '^55[1-9][0-9]9?[0-9]{8}$'),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  admin_notes text,
  privacy_consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index clients_email on public.clients (lower(email));
create index clients_name on public.clients (lower(full_name));

create table public.appointments (
  id uuid primary key default extensions.gen_random_uuid(),
  protocol text not null unique,
  client_id uuid not null references public.clients(id) on delete restrict,
  professional_id uuid not null references public.professionals(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,            -- fim do atendimento
  blocked_until timestamptz not null,      -- fim do atendimento + intervalo de preparo
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'completed', 'cancelled', 'no_show')),
  total_price_cents int,
  total_duration_minutes int not null,
  client_notes text check (length(client_notes) <= 500),
  admin_notes text,
  source text not null default 'online' check (source in ('online', 'admin')),
  idempotency_key text unique,
  policy_accepted_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by text check (cancelled_by in ('client', 'admin')),
  cancel_reason text,
  reschedule_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at and blocked_until >= ends_at),
  -- NUNCA duas reservas ativas sobrepostas para a mesma profissional.
  constraint appointments_no_overlap exclude using gist (
    professional_id with =,
    tstzrange(starts_at, blocked_until, '[)') with &&
  ) where (status <> 'cancelled')
);
create index appointments_starts on public.appointments (starts_at);
create index appointments_client on public.appointments (client_id, starts_at desc);
create index appointments_status on public.appointments (status, starts_at);

create table public.appointment_services (
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  position smallint not null,
  service_id uuid references public.services(id) on delete set null,
  service_name text not null,
  duration_minutes int not null,
  price_cents int,
  primary key (appointment_id, position)
);
create index appointment_services_service on public.appointment_services (service_id);

-- ---------------------------------------------------------------------------
-- Notificações (fila com deduplicação), auditoria, limites de uso
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  appointment_id uuid references public.appointments(id) on delete cascade,
  channel text not null check (channel in ('email', 'whatsapp')),
  audience text not null check (audience in ('client', 'owner')),
  kind text not null check (kind in ('created', 'confirmed', 'cancelled', 'rescheduled', 'reminder')),
  recipient text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed', 'skipped')),
  attempts int not null default 0,
  last_error text,
  dedupe_key text not null unique,
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_pending on public.notifications (status, scheduled_for);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  actor_kind text not null check (actor_kind in ('admin', 'client', 'system')),
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_entity on public.audit_logs (entity, entity_id);
create index audit_logs_created on public.audit_logs (created_at desc);

create table private.rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (bucket, window_start)
);

-- ---------------------------------------------------------------------------
-- Segurança: RLS ligado em tudo, sem políticas para anon/authenticated.
-- Todo acesso passa por funções (schema public) que validam e autorizam.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'business_settings','professionals','admin_roles','service_categories','services',
    'professional_services','business_hours','professional_schedules','schedule_exceptions',
    'blocked_periods','clients','appointments','appointment_services','notifications','audit_logs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- updated_at automático
create or replace function private.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger trg_touch_settings before update on public.business_settings for each row execute function private.touch_updated_at();
create trigger trg_touch_professionals before update on public.professionals for each row execute function private.touch_updated_at();
create trigger trg_touch_services before update on public.services for each row execute function private.touch_updated_at();
create trigger trg_touch_clients before update on public.clients for each row execute function private.touch_updated_at();
create trigger trg_touch_appointments before update on public.appointments for each row execute function private.touch_updated_at();
