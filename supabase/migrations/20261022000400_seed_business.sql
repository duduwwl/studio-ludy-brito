-- Dados iniciais do Studio Ludy Brito.
-- CONFIRMADOS (Instagram @studioludybrito, Google Maps e Linktree da bio, out/2026): nome, endereço, WhatsApp, horários.
-- EXEMPLOS A CONFIRMAR: serviços, durações e preços (is_sample = true), textos de política. Edite pelo painel.

insert into public.business_settings (
  id, trade_name, tagline, about, address_line, neighborhood, city, state, postal_code,
  latitude, longitude, maps_url, whatsapp, instagram, timezone,
  slot_step_minutes, min_advance_minutes, max_advance_days, default_buffer_minutes,
  cancel_min_hours, reschedule_min_hours, auto_confirm, allow_multiple_services, max_services_per_booking,
  booking_policy, cancellation_policy, privacy_contact)
values (
  1, 'Studio Ludy Brito', 'Mais que unhas: uma experiência de cuidado.',
  'Esmalteria e cafeteria no Centro de Lavras. Há mais de 10 anos realçando a beleza das nossas clientes.',
  'R. Bernardino Macieira, 334', 'Centro', 'Lavras', 'MG', '37200-200',
  -21.237044, -44.999144, 'https://maps.app.goo.gl/zp8FTsUzB4LQhaK97', '5535991260502', 'studioludybrito',
  'America/Sao_Paulo',
  30, 120, 60, 10, 12, 12, false, true, 3,
  'Chegue com 5 minutos de antecedência. Atrasos acima de 15 minutos podem exigir remarcação para não prejudicar a cliente seguinte. O agendamento fica pendente até a confirmação do studio.',
  'Cancelamentos e reagendamentos podem ser feitos pelo site até 12 horas antes do horário marcado. Depois disso, fale com a gente pelo WhatsApp.',
  'Para dúvidas sobre seus dados pessoais, fale com o studio pelo WhatsApp (35) 99126-0502.')
on conflict (id) do nothing;

-- Horário confirmado no Google Maps: ter–sex 08:00–19:00, sáb 09:00–13:00, dom e seg fechado.
insert into public.business_hours (weekday, start_time, end_time) values
  (2, '08:00', '19:00'), (3, '08:00', '19:00'), (4, '08:00', '19:00'), (5, '08:00', '19:00'),
  (6, '09:00', '13:00');

-- Profissional inicial: a proprietária. Ajuste nome, foto e serviços no painel.
insert into public.professionals (id, name, slug, sort_order, color)
values ('6b1f2b3c-0000-4000-8000-000000000001', 'Ludy Brito', 'ludy-brito', 0, '#8a5a3c');

insert into public.service_categories (id, name, slug, sort_order) values
  ('5c000000-0000-4000-8000-000000000001', 'Mãos', 'maos', 1),
  ('5c000000-0000-4000-8000-000000000002', 'Pés', 'pes', 2),
  ('5c000000-0000-4000-8000-000000000003', 'Alongamento', 'alongamento', 3);

-- Serviços de EXEMPLO (is_sample = true). Alongamento + gel e gel nos pés aparecem em publicações do studio;
-- nomes, durações e valores precisam ser confirmados pela proprietária.
insert into public.services (id, category_id, name, slug, summary, description, duration_minutes, buffer_after_minutes,
  price_cents, price_is_starting, image_path, image_alt, combinable, is_sample, sort_order) values
  ('5e000000-0000-4000-8000-000000000001', '5c000000-0000-4000-8000-000000000001', 'Manicure', 'manicure',
   'Cutilagem, formato e esmaltação tradicional.',
   'Cuidado completo das unhas das mãos: higienização, cutilagem, lixamento no formato que você preferir e esmaltação com esmalte tradicional.',
   50, null, 3500, false, 'images/gallery/unhas-marsala-cliente', 'Cliente do studio com unhas esmaltadas em marsala', true, true, 1),
  ('5e000000-0000-4000-8000-000000000002', '5c000000-0000-4000-8000-000000000001', 'Esmaltação em gel', 'esmaltacao-em-gel',
   'Brilho e cor que duram semanas.',
   'Preparação da unha natural e aplicação de esmalte em gel curado em cabine, com acabamento de alto brilho.',
   75, null, 8000, false, 'images/gallery/unhas-azul-glitter-maos', 'Mãos com esmaltação azul com glitter feita no studio', true, true, 2),
  ('5e000000-0000-4000-8000-000000000003', '5c000000-0000-4000-8000-000000000002', 'Pedicure', 'pedicure',
   'Cutilagem, lixamento e esmaltação dos pés.',
   'Higienização, cutilagem, lixamento e esmaltação tradicional das unhas dos pés.',
   60, null, 4000, false, 'images/gallery/pes-branco-collab-isabella', 'Pés com esmaltação branca', true, true, 3),
  ('5e000000-0000-4000-8000-000000000004', '5c000000-0000-4000-8000-000000000002', 'Esmaltação em gel nos pés', 'esmaltacao-em-gel-nos-pes',
   'A paz de uma esmaltação em gel nos pés.',
   'Preparação das unhas dos pés e esmaltação em gel, com acabamento que resiste ao dia a dia e ao calçado aberto.',
   70, null, 7000, false, 'images/services/esmaltacao-gel-pes', 'Pés com esmaltação em gel francesinha feita no studio', true, true, 4),
  ('5e000000-0000-4000-8000-000000000005', '5c000000-0000-4000-8000-000000000003', 'Alongamento em gel', 'alongamento-em-gel',
   'Alongamento e esmaltação em gel no formato que você escolher.',
   'Construção do alongamento em gel com formato e comprimento personalizados, finalizado com esmaltação em gel.',
   150, 15, 16000, true, 'images/services/alongamento-esmaltacao-gel', 'Alongamento em gel nude com pontos de brilho feito no studio', false, true, 5),
  ('5e000000-0000-4000-8000-000000000006', '5c000000-0000-4000-8000-000000000003', 'Manutenção de alongamento', 'manutencao-de-alongamento',
   'Reposição do crescimento e nova esmaltação.',
   'Manutenção do alongamento em gel: preenchimento da área de crescimento, ajuste do formato e nova esmaltação.',
   120, 15, 11000, true, 'images/gallery/unhas-preto-francesinha-dourada', 'Unhas alongadas em preto com francesinha dourada', false, true, 6);

insert into public.professional_services (professional_id, service_id)
select '6b1f2b3c-0000-4000-8000-000000000001', id from public.services;

-- Feriados nacionais (studio fechado). Inclua os feriados municipais de Lavras pelo painel.
insert into public.schedule_exceptions (professional_id, date, kind, reason) values
  (null, '2026-11-02', 'holiday', 'Finados'),
  (null, '2026-11-20', 'holiday', 'Dia Nacional de Zumbi e da Consciência Negra'),
  (null, '2026-12-25', 'holiday', 'Natal'),
  (null, '2027-01-01', 'holiday', 'Confraternização Universal'),
  (null, '2027-03-26', 'holiday', 'Sexta-feira Santa'),
  (null, '2027-04-21', 'holiday', 'Tiradentes'),
  (null, '2027-09-07', 'holiday', 'Independência do Brasil'),
  (null, '2027-10-12', 'holiday', 'Nossa Senhora Aparecida'),
  (null, '2027-11-02', 'holiday', 'Finados'),
  (null, '2027-11-15', 'holiday', 'Proclamação da República'),
  (null, '2027-11-20', 'holiday', 'Dia Nacional de Zumbi e da Consciência Negra'),
  (null, '2027-12-25', 'holiday', 'Natal');
