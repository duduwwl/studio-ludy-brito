-- Dados FICTÍCIOS apenas para testes locais e revisão visual. Nunca aplicar em produção.
do $$
declare
  names text[] := array['Ana Paula Souza','Beatriz Carvalho','Camila Rezende','Daniela Moreira','Eduarda Lima','Fernanda Alves',
    'Gabriela Teixeira','Helena Costa','Isabela Martins','Juliana Ribeiro','Larissa Fonseca','Mariana Duarte','Natália Pires','Paula Andrade'];
  svc uuid[] := array['5e000000-0000-4000-8000-000000000001','5e000000-0000-4000-8000-000000000002','5e000000-0000-4000-8000-000000000003',
    '5e000000-0000-4000-8000-000000000004','5e000000-0000-4000-8000-000000000005','5e000000-0000-4000-8000-000000000006']::uuid[];
  pro uuid := '6b1f2b3c-0000-4000-8000-000000000001';
  c uuid; s record; d date; t time; st timestamptz; i int := 0; k int; status text;
  today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  for k in 1..array_length(names, 1) loop
    insert into clients (full_name, phone, email, privacy_consent_at)
    values (names[k], '55359' || lpad((88000000 + k * 137)::text, 8, '0'), lower(split_part(names[k], ' ', 1)) || k || '@exemplo.com', now() - (k || ' days')::interval)
    on conflict do nothing;
  end loop;
  for d in select generate_series(today - 20, today + 12, interval '1 day')::date loop
    continue when extract(dow from d) in (0, 1);
    foreach t in array array['08:30','10:00','13:30','15:00','16:30']::time[] loop
      continue when extract(dow from d) = 6 and t > '12:00';
      i := i + 1;
      continue when i % 3 = 0;
      select id into c from clients order by created_at offset (i % array_length(names, 1)) limit 1;
      select * into s from services where id = svc[1 + (i % 6)];
      st := (d + t) at time zone 'America/Sao_Paulo';
      status := case when d < today then (case when i % 11 = 0 then 'no_show' when i % 7 = 0 then 'cancelled' else 'completed' end)
                     else (case when i % 4 = 0 then 'pending' else 'confirmed' end) end;
      begin
        insert into appointments (protocol, client_id, professional_id, starts_at, ends_at, blocked_until, status, total_price_cents,
          total_duration_minutes, source, cancelled_by)
        values (private.new_protocol(), c, pro, st, st + make_interval(mins => s.duration_minutes), st + make_interval(mins => s.duration_minutes + 10),
          status, s.price_cents, s.duration_minutes, case when i % 2 = 0 then 'online' else 'admin' end, case when status = 'cancelled' then 'client' end)
        returning id into c;
        insert into appointment_services values (c, 1, s.id, s.name, s.duration_minutes, s.price_cents);
      exception when exclusion_violation then null;
      end;
    end loop;
  end loop;
end $$;
