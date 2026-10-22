-- Fila de notificações: funções usadas pela Edge Function "process-notifications" (somente service_role).

alter table public.notifications add column if not exists claimed_at timestamptz;

create or replace function public.notification_claim_batch(p_limit int default 20)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  tz text := private.tz();
  st public.business_settings := private.settings();
  ids uuid[];
begin
  if auth.role() <> 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  -- devolve à fila o que ficou preso em "processing" por mais de 10 minutos
  update notifications set status = 'pending'
   where status = 'processing' and claimed_at < now() - interval '10 minutes' and attempts < 5;

  select array_agg(id) into ids from (
    select id from notifications
    where status = 'pending' and scheduled_for <= now() and attempts < 5
    order by scheduled_for
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
    for update skip locked) x;
  if ids is null then return '[]'; end if;
  update notifications set status = 'processing', attempts = attempts + 1, claimed_at = now() where id = any(ids);

  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', n.id, 'channel', n.channel, 'audience', n.audience, 'kind', n.kind, 'recipient', n.recipient, 'attempts', n.attempts,
      'appointment', jsonb_build_object(
        'protocol', a.protocol, 'status', a.status,
        'date', to_char(a.starts_at at time zone tz, 'DD/MM/YYYY'),
        'time', to_char(a.starts_at at time zone tz, 'HH24:MI'),
        'services', (select string_agg(s.service_name, ' + ' order by s.position) from appointment_services s where s.appointment_id = a.id),
        'professional', p.name, 'client_name', c.full_name, 'client_phone', c.phone,
        'manage_token', private.manage_token(a.id, a.protocol)),
      'business', jsonb_build_object('name', st.trade_name, 'whatsapp', st.whatsapp,
        'address', concat_ws(', ', st.address_line, st.neighborhood, st.city || ' - ' || st.state))
    )), '[]')
    from notifications n
    join appointments a on a.id = n.appointment_id
    join clients c on c.id = a.client_id
    join professionals p on p.id = a.professional_id
    where n.id = any(ids));
end $$;

create or replace function public.notification_mark(p_id uuid, p_status text, p_error text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_status not in ('sent', 'failed', 'skipped', 'pending') then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;
  update notifications set status = p_status, last_error = left(p_error, 500),
         sent_at = case when p_status = 'sent' then now() else sent_at end,
         scheduled_for = case when p_status = 'pending' then now() + interval '5 minutes' else scheduled_for end
   where id = p_id;
end $$;

revoke execute on function public.notification_claim_batch(int) from public, anon, authenticated;
revoke execute on function public.notification_mark(uuid, text, text) from public, anon, authenticated;
grant execute on function public.notification_claim_batch(int) to service_role;
grant execute on function public.notification_mark(uuid, text, text) to service_role;
