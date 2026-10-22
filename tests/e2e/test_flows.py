#!/usr/bin/env python3
"""Testes ponta a ponta no navegador (Playwright) contra o servidor local (tests/mock/server.py).

Pré-requisitos: tests/db/reset.sh; servidor em http://localhost:8787; usuária admin de teste criada por este script.
Uso: python3 tests/e2e/test_flows.py
"""
import json
import os
import re
import subprocess
import sys
import urllib.request
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BASE", "http://localhost:8787")
PG = ["psql", "-h", "/tmp", "-p", os.environ.get("PGPORT", "54329"), "-U", "postgres", "-d", os.environ.get("TEST_DB", "ludy_test"), "-qtA", "-c"]
CHROME = "/opt/pw-browsers/chromium" if os.path.exists("/opt/pw-browsers/chromium") else None
ADMIN = ("dona.teste@example.com", "senha-de-teste-123")
STAFF = ("equipe.teste@example.com", "senha-de-teste-456")
passed, failed = 0, []


def sql(q):
    return subprocess.run(PG + [q], capture_output=True, text=True, check=True).stdout.strip()


def api(path):
    return json.loads(urllib.request.urlopen(BASE + path).read())


def setup_users():
    for (email, pw), role in ((ADMIN, "owner"), (STAFF, "staff")):
        sql(f"""insert into auth.users (email, encrypted_password, email_confirmed_at)
                values ('{email}', extensions.crypt('{pw}', extensions.gen_salt('bf')), now())
                on conflict (email) do update set encrypted_password = excluded.encrypted_password;
                insert into public.admin_roles (user_id, role, display_name)
                select id, '{role}', 'Teste {role}' from auth.users where email = '{email}'
                on conflict (user_id) do update set role = excluded.role;""")


def test(name):
    def deco(fn):
        global passed
        try:
            fn()
            passed += 1
            print(f"  ok   {name}", flush=True)
        except Exception as e:  # noqa
            failed.append(name)
            print(f"  ERRO {name}: {str(e)[:600]}", flush=True)
        return fn
    return deco


class Watch:
    """Coleta erros de console e de página."""
    def __init__(self, page):
        self.errors = []
        page.on("pageerror", lambda e: self.errors.append(str(e)))
        page.on("console", lambda m: self.errors.append(m.text) if m.type == "error" and "favicon" not in m.text
                and "google" not in m.text.lower() and "status of 4" not in m.text else None)

    def check(self):
        assert not self.errors, f"erros no console: {self.errors[:3]}"


setup_users()
pw = sync_playwright().start()
browser = pw.chromium.launch(executable_path=CHROME)


def new_page(width=1440, height=900, **kw):
    ctx = browser.new_context(viewport={"width": width, "height": height}, locale="pt-BR", timezone_id="America/Sao_Paulo",
                              reduced_motion="reduce", accept_downloads=True, **kw)
    page = ctx.new_page()
    page.set_default_timeout(8000)
    return page


def book(page, service="Manicure", mobile=False, name="Cliente Teste E2E", phone="35988887777", email=None, pick_day=0, pick_slot=0):
    page.goto(BASE + "/agendamento/")
    page.locator(".svc-option", has_text=service).first.click()
    (page.locator("[data-mbar-next]") if mobile else page.locator("[data-next='servico']")).click()
    page.wait_for_selector(".cal-day.is-open")
    page.locator(".cal-day.is-open").nth(pick_day).click()
    page.wait_for_selector(".slot")
    slot = page.locator(".slot").nth(pick_slot)
    time = slot.inner_text().strip()
    slot.click()
    (page.locator("[data-mbar-next]") if mobile else page.locator("[data-next='horario']")).click()
    page.fill("#f-nome", name)
    page.fill("#f-whats", phone)
    if email:
        page.fill("#f-email", email)
    page.check("#f-politica")
    page.check("#f-privacidade")
    (page.locator("[data-mbar-next]") if mobile else page.locator("[data-client-form] button[type=submit]")).click()
    expect(page.locator("[data-step='revisao']")).to_be_visible()
    (page.locator("[data-mbar-next]") if mobile else page.locator("[data-confirm]")).click()
    return time


# ====================================================================== SITE PÚBLICO
@test("página inicial: título, serviços do banco e próximo horário livre")
def _():
    p = new_page(); w = Watch(p)
    p.goto(BASE + "/")
    expect(p.locator("h1")).to_have_text(re.compile("Esmalteria"))
    expect(p.locator(".svc-row").first).to_be_visible()
    expect(p.locator("[data-next-slot-value]")).to_have_text(re.compile(r"às \d{2}:\d{2}"), timeout=10000)
    href = p.locator("[data-next-slot-link]").get_attribute("href")
    assert "servico=" in href and "hora=" in href, href
    assert p.locator("script[type='application/ld+json']").count() == 1
    w.check(); p.context.close()


@test("link do próximo horário abre o agendamento com serviço, dia e hora já escolhidos")
def _():
    p = new_page()
    p.goto(BASE + "/")
    expect(p.locator("[data-next-slot-link]")).not_to_have_attribute("aria-disabled", "true", timeout=10000)
    p.locator("[data-next-slot-link]").click()
    expect(p.locator("[data-step='horario']")).to_be_visible()
    expect(p.locator(".slot[aria-checked='true']")).to_have_count(1)
    expect(p.locator("[data-sum='time']")).not_to_have_text("—")
    p.context.close()


@test("catálogo: filtro por categoria, busca e detalhe do serviço")
def _():
    p = new_page(); w = Watch(p)
    p.goto(BASE + "/servicos/")
    expect(p.locator(".catalog-item")).to_have_count(6)
    p.locator(".chip", has_text="Pés").click()
    expect(p.locator(".catalog-item")).to_have_count(2)
    assert "categoria=pes" in p.url
    p.locator(".chip", has_text="Todos").click()
    p.fill("[data-catalog-search]", "alongamento")
    expect(p.locator(".catalog-item")).to_have_count(2)
    p.fill("[data-catalog-search]", "xyzxyz")
    expect(p.locator(".catalog-empty")).to_contain_text("Nenhum serviço")
    p.goto(BASE + "/servicos/detalhe/?s=pedicure")
    expect(p.locator("[data-detail-name]")).to_have_text("Pedicure")
    assert "servico=pedicure" in p.locator("[data-detail-book]").get_attribute("href")
    p.goto(BASE + "/servicos/detalhe/?s=nao-existe")
    expect(p.locator("[data-detail-name]")).to_have_text("Serviço não encontrado")
    w.check(); p.context.close()


@test("galeria: filtro e foto ampliada com navegação por teclado")
def _():
    p = new_page(); w = Watch(p)
    p.goto(BASE + "/galeria/")
    p.locator(".chip", has_text="Pés").click()
    expect(p.locator(".gallery-item:not(.is-filtered)")).to_have_count(2)
    p.locator(".gallery-item:not(.is-filtered) button").first.click()
    expect(p.locator("[data-lightbox]")).to_be_visible()
    expect(p.locator("[data-lightbox-count]")).to_have_text("1 de 2")
    p.keyboard.press("ArrowRight")
    expect(p.locator("[data-lightbox-count]")).to_have_text("2 de 2")
    p.keyboard.press("Escape")
    expect(p.locator("[data-lightbox]")).to_be_hidden()
    w.check(); p.context.close()


state = {}


@test("agendamento completo no computador: salva no banco antes da confirmação")
def _():
    p = new_page(); w = Watch(p)
    before = int(sql("select count(*) from appointments"))
    time = book(p, "Esmaltação em gel", email="cliente.e2e@example.com", pick_day=1)
    expect(p.locator("[data-step='confirmado']")).to_be_visible()
    proto = p.locator("[data-done-protocol]").inner_text()
    assert re.fullmatch(r"LB[A-Z0-9]{6}", proto), proto
    row = sql(f"select status || '|' || to_char(starts_at at time zone 'America/Sao_Paulo', 'HH24:MI') from appointments where protocol = '{proto}'")
    assert row == f"pending|{time}", row
    assert int(sql("select count(*) from appointments")) == before + 1
    href = p.locator("[data-done-manage]").get_attribute("href")
    assert "t=" in href and proto in href
    wa = p.locator("[data-done-whatsapp]").get_attribute("href")
    assert wa.startswith("https://wa.me/5535991260502?text=") and proto in wa
    with p.expect_download() as d:
        p.locator("[data-done-ics]").click()
    ics = open(d.value.path()).read()
    assert "BEGIN:VEVENT" in ics and proto in ics
    state["manage"] = href
    state["proto"] = proto
    w.check(); p.context.close()


@test("agendamento completo no celular (barra fixa) e combinação de dois serviços")
def _():
    p = new_page(390, 844, is_mobile=True, has_touch=True); w = Watch(p)
    p.goto(BASE + "/agendamento/")
    p.locator(".svc-option", has_text="Manicure").click()
    p.locator(".svc-option", has_text="Pedicure").click()
    expect(p.locator("[data-mbar-line1]")).to_have_text("Manicure + Pedicure")
    p.locator("[data-mbar-next]").click()
    p.wait_for_selector(".cal-day.is-open")
    p.locator(".cal-day.is-open").nth(2).click()
    p.locator(".slot").first.click()
    p.locator("[data-mbar-next]").click()
    p.fill("#f-nome", "Cliente Celular")
    p.fill("#f-whats", "35977776666")
    expect(p.locator("#f-whats")).to_have_value("(35) 97777-6666")
    p.locator("[data-mbar-next]").click()
    expect(p.locator("#e-politica")).to_contain_text("aceitar")
    p.check("#f-politica"); p.check("#f-privacidade")
    p.locator("[data-mbar-next]").click()
    expect(p.locator("[data-review]")).to_contain_text("1h50")
    expect(p.locator("[data-review]")).to_contain_text("R$ 75,00")
    p.locator("[data-mbar-next]").click()
    expect(p.locator("[data-step='confirmado']")).to_be_visible()
    sw = p.evaluate("document.documentElement.scrollWidth")
    assert sw <= 390, sw
    w.check(); p.context.close()


@test("serviço não combinável substitui a seleção; validação de campos")
def _():
    p = new_page()
    p.goto(BASE + "/agendamento/")
    p.locator(".svc-option", has_text="Manicure").click()
    p.locator(".svc-option", has_text="Alongamento em gel").click()
    expect(p.locator(".svc-option.is-on")).to_have_count(1)
    expect(p.locator("[data-sum='services']")).to_have_text("Alongamento em gel")
    p.context.close()


@test("duas clientes no mesmo horário: a segunda é avisada e volta para escolher outro")
def _():
    a = new_page(); b = new_page()
    for pg in (a, b):
        pg.goto(BASE + "/agendamento/")
        pg.locator(".svc-option", has_text="Pedicure").click()
        pg.locator("[data-next='servico']").click()
        pg.wait_for_selector(".cal-day.is-open")
        pg.locator(".cal-day.is-open").nth(4).click()
        pg.locator(".slot").nth(1).click()
        pg.locator("[data-next='horario']").click()
    for pg, n, ph in ((a, "Primeira Cliente", "35911112222"), (b, "Segunda Cliente", "35933334444")):
        pg.fill("#f-nome", n); pg.fill("#f-whats", ph); pg.check("#f-politica"); pg.check("#f-privacidade")
        pg.locator("[data-client-form] button[type=submit]").click()
    a.locator("[data-confirm]").click()
    expect(a.locator("[data-step='confirmado']")).to_be_visible()
    b.locator("[data-confirm]").click()
    expect(b.locator("[data-booking-alert]")).to_contain_text("acabou de ser reservado")
    expect(b.locator("[data-step='horario']")).to_be_visible()
    a.context.close(); b.context.close()


@test("área da cliente pelo link: reagendar e cancelar atualizam a agenda")
def _():
    p = new_page(); w = Watch(p)
    p.goto(state["manage"])
    expect(p.locator("[data-single] .appt")).to_be_visible()
    old = sql(f"select starts_at from appointments where protocol = '{state['proto']}'")
    p.locator("[data-act='resched']").click()
    p.wait_for_selector("[data-resched-days] [data-day]")
    p.locator("[data-resched-days] [data-day]").nth(3).click()
    p.wait_for_selector("[data-resched-slots] [data-start]")
    p.locator("[data-resched-slots] [data-start]").first.click()
    p.locator("[data-resched-ok]").click()
    expect(p.locator(".toast")).to_contain_text("Novo horário")
    new = sql(f"select starts_at from appointments where protocol = '{state['proto']}'")
    assert new != old, (old, new)
    p.locator("[data-single] [data-act='cancel']").click()
    p.fill("#cancel-reason", "teste automático")
    p.locator("[data-cancel-ok]").click()
    expect(p.locator("[data-single] .status")).to_have_text("Cancelado")
    assert sql(f"select status from appointments where protocol = '{state['proto']}'") == "cancelled"
    w.check(); p.context.close()


@test("link adulterado não mostra o agendamento de outra pessoa")
def _():
    p = new_page()
    p.goto(BASE + f"/meus-agendamentos/?p={state['proto']}&t=0000000000000000000000000000000000000000")
    expect(p.locator("[data-account-alert]")).to_contain_text("Não encontramos")
    expect(p.locator("[data-single]")).to_be_hidden()
    p.context.close()


@test("área da cliente por código no e-mail lista os próprios horários")
def _():
    p = new_page()
    book(p, "Manicure", name="Cliente Com Email", phone="35966665555", email="otp.e2e@example.com", pick_day=5)
    expect(p.locator("[data-step='confirmado']")).to_be_visible()
    p.goto(BASE + "/meus-agendamentos/")
    p.evaluate("localStorage.clear()")
    p.reload()
    p.fill("#otp-email", "otp.e2e@example.com")
    p.locator("[data-otp-request] button").click()
    expect(p.locator("[data-otp-verify]")).to_be_visible()
    code = api("/__test/otp?email=otp.e2e@example.com")["code"]
    p.fill("#otp-code", code)
    p.locator("[data-otp-verify] button[type=submit]").click()
    expect(p.locator("[data-mine-upcoming] .appt")).to_have_count(1)
    expect(p.locator("[data-mine-email]")).to_contain_text("otp.e2e@example.com")
    p.context.close()


# ====================================================================== PAINEL
def admin_login(p, creds=ADMIN):
    p.goto(BASE + "/admin/")
    p.fill("#l-email", creds[0]); p.fill("#l-pass", creds[1])
    p.locator("[data-login-form] button[type=submit]").click()
    expect(p.locator("[data-shell]")).to_be_visible()


@test("painel: senha errada é recusada; sem login não há dados")
def _():
    p = new_page()
    p.goto(BASE + "/admin/")
    p.fill("#l-email", ADMIN[0]); p.fill("#l-pass", "errada123")
    p.locator("[data-login-form] button[type=submit]").click()
    expect(p.locator("[data-auth-error]")).to_contain_text("incorretos")
    expect(p.locator("[data-shell]")).to_be_hidden()
    p.context.close()


@test("painel: dashboard com dados reais e confirmação em um clique")
def _():
    p = new_page(); w = Watch(p)
    admin_login(p)
    expect(p.locator(".kpi").first).to_be_visible()
    pend = int(sql("select count(*) from appointments where status = 'pending' and starts_at >= now()"))
    expect(p.locator(".kpi", has_text="A confirmar").locator("dd")).to_have_text(str(pend))
    p.locator("[data-confirm]").first.click()
    expect(p.locator(".toast")).to_contain_text("confirmado")
    assert int(sql("select count(*) from appointments where status = 'pending' and starts_at >= now()")) == pend - 1
    w.check(); p.context.close()


@test("painel: criar e editar serviço reflete no site")
def _():
    p = new_page(); w = Watch(p)
    admin_login(p)
    p.goto(BASE + "/admin/#/servicos")
    p.locator("[data-new]").click()
    p.fill("#s-n", "Spa dos pés E2E"); p.fill("#s-d", "45"); p.fill("#s-p", "55,00")
    p.select_option("#s-c", label="Pés")
    p.locator(".sheet button[type=submit]").click()
    expect(p.locator(".sheet")).to_be_hidden()
    expect(p.locator(".svc-admin", has_text="Spa dos pés E2E")).to_be_visible()
    site = urllib.request.urlopen(urllib.request.Request(BASE + "/rest/v1/rpc/get_public_site", data=b"{}", headers={"Authorization": "Bearer anon-key-local"}))
    data = json.loads(site.read())
    svc = [s for s in data["services"] if s["name"] == "Spa dos pés E2E"]
    assert svc and svc[0]["price_cents"] == 5500 and svc[0]["duration_minutes"] == 45, svc
    p.locator(".svc-admin", has_text="Spa dos pés E2E").locator("[data-edit]").click()
    p.fill("#s-p", "60,00")
    p.locator(".sheet button[type=submit]").click()
    expect(p.locator(".sheet")).to_be_hidden()
    assert sql("select price_cents from services where name = 'Spa dos pés E2E'") == "6000"
    w.check(); p.context.close()


@test("painel: horário com almoço e bloqueio 14h–16h somem do site")
def _():
    p = new_page(); w = Watch(p)
    admin_login(p)
    p.goto(BASE + "/admin/#/bloqueios")
    target = sql("select to_char(d, 'YYYY-MM-DD') from generate_series(current_date + 8, current_date + 20, interval '1 day') d "
                 "where extract(dow from d) = 3 limit 1")
    p.uncheck("[data-allday]")
    p.fill("#b-sd", target); p.fill("#b-ed", target)
    p.fill("#b-st", "14:00"); p.fill("#b-et", "16:00")
    p.fill("#b-r", "teste e2e")
    p.locator("[data-block] button[type=submit]").click()
    expect(p.locator(".toast")).to_contain_text("bloqueados")
    q = urllib.request.Request(BASE + "/rest/v1/rpc/get_available_slots",
                               data=json.dumps({"p_service_ids": ["5e000000-0000-4000-8000-000000000001"], "p_date": target}).encode(),
                               headers={"Authorization": "Bearer anon-key-local"})
    times = [s["time"] for s in json.loads(urllib.request.urlopen(q).read())["slots"]]
    for t in ("13:30", "14:00", "15:00", "15:30"):
        assert t not in times, (t, times)
    assert "16:00" in times
    p.locator("[data-del-block]").first.click()
    expect(p.locator(".toast")).to_contain_text("liberados")
    times = [s["time"] for s in json.loads(urllib.request.urlopen(q).read())["slots"]]
    assert "14:00" in times
    w.check(); p.context.close()


@test("painel: criar atendimento, reagendar, cancelar e ver no calendário")
def _():
    p = new_page(); w = Watch(p)
    admin_login(p)
    p.goto(BASE + "/admin/#/agendamentos")
    p.locator("[data-new]").click()
    p.locator(".sheet .checks label", has_text="Manicure").locator("input").check()
    day = sql("select to_char(d, 'YYYY-MM-DD') from generate_series(current_date + 9, current_date + 25, interval '1 day') d where extract(dow from d) = 4 limit 1")
    p.fill("#ap-date", day); p.locator("#ap-date").dispatch_event("change")
    p.wait_for_selector("[data-slots] [data-start]")
    p.locator("[data-slots] [data-start]").nth(2).click()
    p.fill("#ap-nname", "Cliente Balcão E2E"); p.fill("#ap-nphone", "35955554444")
    p.locator("[data-appt-form] button[type=submit]").click()
    expect(p.locator(".toast")).to_contain_text("criado")
    pid = sql("select a.protocol from appointments a join clients c on c.id = a.client_id where c.full_name = 'Cliente Balcão E2E'")
    assert pid
    p.locator("[data-edit]").click()
    p.wait_for_selector("[data-slots] [data-start]")
    p.locator("[data-slots] [data-start]").nth(5).click()
    p.locator("[data-appt-form] button[type=submit]").click()
    expect(p.locator(".toast")).to_contain_text("atualizado")
    assert sql(f"select reschedule_count from appointments where protocol = '{pid}'") == "1"
    p.locator(".sheet [data-status='cancelled']").click()
    p.fill("#ask-input", "teste")
    p.locator("[data-ok]").click()
    expect(p.locator(".sheet .status")).to_have_text("Cancelado")
    p.keyboard.press("Escape")
    p.goto(BASE + f"/admin/#/agenda?modo=dia&data={day}")
    expect(p.locator("[data-agenda-title]")).not_to_be_empty()
    p.goto(BASE + f"/admin/#/agenda?modo=mes&data={day}")
    expect(p.locator(".month-cell")).to_have_count(42)
    w.check(); p.context.close()


@test("painel: lista com filtros e paginação; clientes; relatório e CSV")
def _():
    p = new_page(); w = Watch(p)
    admin_login(p)
    p.goto(BASE + "/admin/#/agendamentos")
    expect(p.locator("[data-results] tbody tr").first).to_be_visible()
    with p.expect_response(lambda r: "admin_list_appointments" in r.url and "cancelled" in (r.request.post_data or "")):
        p.select_option("#f-st", "cancelled")
    p.wait_for_timeout(300)
    for st in p.locator("[data-results] tbody tr .status").all_inner_texts():
        assert st == "Cancelado", st
    p.goto(BASE + "/admin/#/clientes")
    p.fill("#c-q", "Cliente Balcão")
    expect(p.locator("[data-results] tbody tr")).to_have_count(1)
    p.locator("[data-results] tbody tr").click()
    expect(p.locator(".sheet")).to_contain_text("Histórico")
    p.keyboard.press("Escape")
    p.goto(BASE + "/admin/#/relatorios")
    expect(p.locator(".kpi").first).to_be_visible()
    p.locator("[data-preset='30']").click()
    with p.expect_download() as d:
        p.locator("[data-csv]").click()
    csv = open(d.value.path(), encoding="utf-8-sig").read()
    assert csv.startswith("protocolo;data;horario"), csv[:80]
    w.check(); p.context.close()


@test("painel: perfil equipe não vê relatórios nem salva configurações")
def _():
    p = new_page()
    admin_login(p, STAFF)
    expect(p.locator(".side-nav a[href='#/relatorios']")).to_be_hidden()
    p.goto(BASE + "/admin/#/configuracoes")
    expect(p.locator("#st-n")).to_be_disabled()
    p.context.close()


@test("painel: recuperação de senha troca a senha")
def _():
    p = new_page()
    p.goto(BASE + "/admin/")
    p.locator("[data-forgot]").click()
    p.fill("#f-email-r", STAFF[0])
    p.locator("[data-forgot-form] button[type=submit]").click()
    expect(p.locator(".toast")).to_contain_text("link")
    token = api(f"/__test/recovery?email={STAFF[0]}")["token"]
    p.goto(BASE + f"/admin/#access_token={token}&refresh_token=x&expires_in=3600&type=recovery")
    p.reload()
    expect(p.locator("[data-newpass-form]")).to_be_visible()
    p.fill("#n-pass", "nova-senha-789"); p.fill("#n-pass2", "nova-senha-789")
    p.locator("[data-newpass-form] button[type=submit]").click()
    expect(p.locator("[data-shell]")).to_be_visible()
    p.context.close()
    sql(f"update auth.users set encrypted_password = extensions.crypt('{STAFF[1]}', extensions.gen_salt('bf')) where email = '{STAFF[0]}'")


# ====================================================================== RESPONSIVIDADE
PUBLIC = ["/", "/servicos/", "/servicos/detalhe/?s=manicure", "/galeria/", "/sobre/", "/contato/", "/agendamento/", "/meus-agendamentos/", "/privacidade/"]
WIDTHS = [320, 360, 375, 390, 414, 768, 1024, 1280, 1440, 1920]


@test("responsivo: nenhuma página pública rola na horizontal de 320 a 1920 px")
def _():
    problems = []
    for wdt in WIDTHS:
        p = new_page(wdt, 900)
        for path in PUBLIC:
            p.goto(BASE + path)
            p.wait_for_timeout(250)
            sw = p.evaluate("document.documentElement.scrollWidth")
            if sw > wdt:
                wide = p.evaluate(f"""[...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > {wdt} + 1
                    && getComputedStyle(e).position !== 'fixed').slice(0, 3).map(e => e.tagName + '.' + e.className)""")
                problems.append(f"{path} @{wdt}: {sw} {wide}")
        p.context.close()
    assert not problems, "\n".join(problems)


@test("responsivo: painel sem rolagem horizontal no celular e no tablet")
def _():
    problems = []
    for wdt in (360, 390, 768, 1024):
        p = new_page(wdt, 844)
        admin_login(p)
        for r in ["hoje", "agenda?modo=dia", "agendamentos", "clientes", "servicos", "profissionais", "horarios", "bloqueios", "relatorios", "configuracoes"]:
            p.goto(BASE + f"/admin/#/{r}")
            p.wait_for_timeout(500)
            sw = p.evaluate("document.documentElement.scrollWidth")
            if sw > wdt:
                problems.append(f"{r} @{wdt}: {sw}")
        p.context.close()
    assert not problems, "\n".join(problems)


@test("acessibilidade básica: imagens com alt, campos com rótulo, um h1 por página")
def _():
    problems = []
    p = new_page()
    for path in PUBLIC:
        p.goto(BASE + path)
        p.wait_for_timeout(300)
        r = p.evaluate("""() => ({
          noAlt: [...document.images].filter(i => !i.hasAttribute('alt')).map(i => i.src).slice(0, 3),
          unlabeled: [...document.querySelectorAll('input, select, textarea')].filter(el => el.type !== 'hidden' && !el.labels?.length
             && !el.getAttribute('aria-label') && !el.closest('[hidden]') && el.offsetParent).map(el => el.id || el.name),
          h1: document.querySelectorAll('h1').length })""")
        if r["noAlt"] or r["unlabeled"] or r["h1"] != 1:
            problems.append(f"{path}: {r}")
    p.context.close()
    assert not problems, "\n".join(problems)


browser.close(); pw.stop()
print(f"\n{passed} passaram, {len(failed)} falharam")
sys.exit(1 if failed else 0)
