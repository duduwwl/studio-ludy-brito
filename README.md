# Studio Ludy Brito — site, agenda online e painel

Site da **LB Esmalteria & Cafeteria** (Lavras – MG) com:

- **Site público:** início, serviços (catálogo com filtros e busca), detalhe de serviço, galeria com ampliação, sobre, contato com mapa, política de privacidade.
- **Agendamento online:** escolha do serviço (combinação de até 3), profissional, calendário com disponibilidade real calculada no servidor, horários livres, dados da cliente com validação, revisão, confirmação com protocolo, arquivo de calendário (.ics), Google Agenda e mensagem pronta no WhatsApp.
- **Área da cliente:** acesso por link seguro (protocolo + token assinado) ou por código enviado ao e-mail; reagendar e cancelar dentro das regras.
- **Painel da equipe (`/admin/`):** login com recuperação de senha, perfis (proprietária, gerente, equipe), dashboard do dia, agenda dia/semana/mês, lista de agendamentos com filtros, busca, ordenação e paginação, clientes com histórico, serviços e categorias (com upload de imagem), profissionais (serviços e horário próprio), horário de funcionamento com almoço, regras da agenda, feriados e horários especiais, bloqueios (horário, intervalo, dia, vários dias, férias), relatórios com exportação CSV, configurações, acessos e registro de atividades.

## Como foi construído

| Camada | Tecnologia | Por quê |
|---|---|---|
| Páginas | HTML + CSS + JavaScript (módulos ES), **sem etapa de build obrigatória** | Abre em qualquer hospedagem estática (painel da hospedagem, GitHub Pages, Netlify, Vercel). Nenhuma dependência de terceiros no navegador. |
| Montagem das páginas | `tools/build.mjs` (Node, zero dependências) | Cabeçalho, rodapé e imagens responsivas (AVIF + WebP) montados a partir de `src/`. O resultado já está em `site/`. |
| Banco e regras | **Supabase (PostgreSQL + Auth + Storage)** | Toda regra de agenda roda no banco, em funções `security definer`. |
| Notificações | Edge Function `process-notifications` (Deno) | E-mail (Resend) e API oficial do WhatsApp Business, quando configurados. |

> A sugestão inicial era Next.js. O ambiente de desenvolvimento usado não tinha acesso ao npm. Por isso a interface foi feita sem framework, mas com o mesmo resultado para quem usa e com testes reais (veja **Testes**). O banco, a segurança e as regras são as mesmas que seriam usadas com Next.js. Se quiserem migrar no futuro, as funções do banco continuam valendo.

### Garantias da agenda

- A disponibilidade é calculada no servidor: horário do studio, horário próprio da profissional, feriados/exceções, bloqueios, férias, duração somada dos serviços, intervalo de preparo, antecedência mínima e limite de dias à frente. Tudo no fuso `America/Sao_Paulo`.
- **Nunca há duas reservas sobrepostas para a mesma profissional:** uma *exclusion constraint* (`appointments_no_overlap`) no PostgreSQL recusa a segunda reserva, mesmo que as duas cheguem no mesmo milissegundo. O horário é revalidado dentro da transação ao confirmar.
- Reenvio idempotente: a mesma requisição de agendamento repetida devolve o mesmo agendamento.
- Limite de tentativas por WhatsApp e por IP. Validação de todos os campos no servidor.
- RLS ligado em todas as tabelas, sem acesso direto para `anon`/`authenticated`: tudo passa por funções que validam e autorizam por perfil.
- Ninguém acessa um agendamento só com o telefone: é preciso o token assinado (HMAC) do link ou confirmar o e-mail com código.

## Estrutura

```text
site/                     ← o que vai para a hospedagem (gerado + CSS/JS/imagens)
  assets/css/             site.css, booking.css, admin.css
  assets/js/              api.js (cliente Supabase mínimo), site.js, home.js, booking.js, account.js, …
  assets/js/admin/        app.js (rotas e login), views.js (telas), appointment.js, core.js
  images/                 brand/, hero/, gallery/, services/, studio/, backgrounds/ (AVIF + WebP + JPG)
src/                      páginas e partes reutilizáveis (fonte do HTML)
  pages/  partials/  business.json (dados confirmados do studio + JSON-LD)
supabase/
  migrations/             estrutura, motor de agenda, API do painel, dados iniciais, notificações, storage
  functions/process-notifications/
tools/                    build.mjs (monta o HTML), images.py (gera as imagens otimizadas)
tests/                    db/ (testes do banco), e2e/ (testes no navegador), mock/ (servidor local)
assets-originais/         fotos originais baixadas do Instagram do studio
```

## Instalação

### 1. Supabase

1. Crie um projeto em [supabase.com](https://supabase.com), na região **São Paulo**.
2. Em **SQL Editor**, rode os arquivos de `supabase/migrations/` **em ordem** (`…0100` até `…0600`). Se preferir, use a CLI: `supabase link` + `supabase db push`.
3. Em **Authentication → Providers → Email**, mantenha o e-mail habilitado. Em **Authentication → Email Templates → Magic Link**, inclua o código: `Seu código: {{ .Token }}`. A área da cliente usa esse código de 6 dígitos.
4. Em **Authentication → URL Configuration**, coloque a URL do site em *Site URL* e adicione `https://SEU-SITE/admin/` em *Redirect URLs*. O link de recuperação de senha volta para lá.
5. Para enviar e-mails com o seu domínio (recomendado), configure um SMTP próprio em **Authentication → SMTP**. O serviço de e-mail padrão do Supabase tem limite baixo de envios.

### 2. Primeira usuária do painel (proprietária)

1. Em **Authentication → Users → Invite user**, convide o e-mail da proprietária. Ela define a senha pelo e-mail recebido.
2. No **SQL Editor**:

   ```sql
   insert into public.admin_roles (user_id, role, display_name)
   select id, 'owner', 'Ludy Brito' from auth.users where email = 'EMAIL-DA-PROPRIETARIA';
   ```

As demais pessoas da equipe são convidadas da mesma forma e recebem acesso pelo próprio painel, em **Configurações → Acesso ao painel**.

### 3. Chaves no site

Copie `site/assets/js/config.example.js` para `site/assets/js/config.js` e preencha os campos com os dados de **Project Settings → API**:

```js
window.LB_CONFIG = {
  supabaseUrl: 'https://SEU-PROJETO.supabase.co',
  supabaseAnonKey: 'CHAVE-ANON-PUBLICA',
};
```

A chave **anon** é pública por natureza; a segurança está nas funções e no RLS. **Nunca** coloque a chave `service_role` no site.

### 4. Publicar

O site é a pasta `site/`. Ele funciona em subpasta (ex.: GitHub Pages) e em domínio próprio.

- **Painel da hospedagem:** envie o conteúdo de `site/` para a pasta pública (`public_html`).
- **GitHub Pages:** o workflow `.github/workflows/pages.yml` publica `site/` a cada push na `main`. As chaves vêm dos *secrets* `SUPABASE_URL` e `SUPABASE_ANON_KEY` do repositório.
- **Domínio próprio:** ajuste `siteUrl` em `src/business.json` (URL canônica, sitemap e JSON-LD) e rode `node tools/build.mjs`.

Depois de editar algo em `src/`, rode `node tools/build.mjs` (Node 18+) para regenerar as páginas.

### 5. Notificações (opcional)

Sem configuração, nada é enviado automaticamente. As telas oferecem botões de WhatsApp com mensagem pronta. Para ativar os envios:

```bash
supabase functions deploy process-notifications --no-verify-jwt
supabase secrets set CRON_SECRET=um-segredo-longo SITE_URL=https://SEU-SITE \
  RESEND_API_KEY=... EMAIL_FROM="Studio Ludy Brito <agenda@seudominio.com.br>"
# WhatsApp Business (API oficial da Meta, modelos aprovados com 4 variáveis: nome, serviço, data, horário)
supabase secrets set WHATSAPP_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=... WHATSAPP_TEMPLATE_CREATED=... \
  WHATSAPP_TEMPLATE_CONFIRMED=... WHATSAPP_TEMPLATE_CANCELLED=... WHATSAPP_TEMPLATE_RESCHEDULED=... WHATSAPP_TEMPLATE_REMINDER=...
```

Agende a função a cada 5 minutos. No SQL Editor, com as extensões `pg_cron` e `pg_net` habilitadas:

```sql
select cron.schedule('notificacoes', '*/5 * * * *', $$
  select net.http_post(url := 'https://SEU-PROJETO.supabase.co/functions/v1/process-notifications',
                       headers := '{"x-cron-secret": "um-segredo-longo"}'::jsonb)
$$);
```

Por fim, ligue as opções em **Painel → Configurações → Notificações**. A fila não duplica envios: cada notificação tem uma chave única. O painel mostra quantas foram enviadas, falharam ou foram ignoradas.

## Testes

Os testes rodam contra um PostgreSQL local com as mesmas migrations e um servidor local que imita a API do Supabase (`tests/mock/server.py`, só para testes).

```bash
# banco local (PostgreSQL 16) na porta 54329, socket em /tmp
tests/db/reset.sh                     # recria o banco e aplica as migrations
python3 tests/db/test_engine.py       # 30 testes do motor de agenda e do painel (inclui concorrência)
tests/mock/restart.sh                 # sobe o site + API local em http://localhost:8787
psql -h /tmp -p 54329 -U postgres -d ludy_test -f tests/db/demo_data.sql   # dados fictícios para revisão
python3 tests/e2e/test_flows.py       # 22 testes no navegador (Playwright): cliente, painel, responsivo, acessibilidade
```

Cobertura principal: agendamento completo no computador e no celular, combinação de serviços, duas clientes no mesmo horário (só uma confirma), reagendar, cancelar, link adulterado, login por código, senha errada, dashboard, confirmação em um clique, criação e edição de serviço refletindo no site, bloqueio 14h–16h removendo horários, criação/reagendamento/cancelamento pelo painel, filtros, clientes, relatório e CSV, permissões por perfil, recuperação de senha, ausência de rolagem horizontal de 320 a 1920 px (site) e de 360 a 1024 px (painel), `alt` em imagens e rótulos em campos.

## Conteúdo: o que é real e o que é exemplo

**Confirmado** (Instagram @studioludybrito e links da bio, out/2026):

- Nome e bio do perfil.
- Endereço: R. Bernardino Macieira, 334, Centro, Lavras – MG, 37200-200.
- WhatsApp: (35) 99126-0502 (Linktree da bio).
- Horário: terça a sexta 8h–19h, sábado 9h–13h (ficha do Google Maps vinculada na bio).
- Fotos dos trabalhos.

**Exemplo, a confirmar com a proprietária:**

- Os 6 serviços, durações e preços. Aparecem como "exemplo" no painel e deixam de ser exemplo ao serem salvos.
- A profissional inicial "Ludy Brito".
- Os textos de política de agendamento e cancelamento (prazo de 12 h).
- Os feriados nacionais semeados. Faltam os municipais de Lavras.

**Fotos:** todas vieram de publicações do Instagram do studio. Uma é colaboração com @isabella_carvalhonails, com o crédito na legenda da galeria. O uso foi autorizado pelo responsável pelo projeto. Os originais estão em `assets-originais/`. As versões otimizadas são geradas com `python3 tools/images.py assets-originais`.

**Pendências para o lançamento:**

1. Logotipo em alta resolução. O do Instagram tem só 150 px.
2. Fotos do ambiente, da cafeteria e da proprietária.
3. Lista real de serviços e preços.
4. Autorização de imagem das clientes que aparecem de rosto (foto do hero e foto "marsala").
5. Credenciais de e-mail e, se houver, da API do WhatsApp Business.
6. Domínio definitivo.
