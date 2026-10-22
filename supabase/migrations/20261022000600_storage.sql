-- Armazenamento de imagens enviadas pelo painel (serviços, profissionais, logotipo).
-- Bucket público para leitura; envio e remoção só para a equipe autorizada.

insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

drop policy if exists "media: equipe envia" on storage.objects;
create policy "media: equipe envia" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and exists (select 1 from public.admin_roles r where r.user_id = auth.uid()));

drop policy if exists "media: equipe altera" on storage.objects;
create policy "media: equipe altera" on storage.objects
  for update to authenticated
  using (bucket_id = 'media' and exists (select 1 from public.admin_roles r where r.user_id = auth.uid()));

drop policy if exists "media: equipe remove" on storage.objects;
create policy "media: equipe remove" on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and exists (select 1 from public.admin_roles r where r.user_id = auth.uid()));
