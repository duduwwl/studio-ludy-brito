#!/usr/bin/env python3
"""Testes do motor de agenda contra um PostgreSQL local com as migrations aplicadas.

Uso:  tests/db/reset.sh && python3 tests/db/test_engine.py
"""
import concurrent.futures
import datetime as dt
import json
import os
import subprocess
import sys
import random
import uuid

PORT = os.environ.get("PGPORT", "54329")
DB = os.environ.get("TEST_DB", "ludy_test")
TZ = dt.timezone(dt.timedelta(hours=-3))  # America/Sao_Paulo (sem horário de verão desde 2019)

MANICURE = "5e000000-0000-4000-8000-000000000001"
GEL = "5e000000-0000-4000-8000-000000000002"
ALONG = "5e000000-0000-4000-8000-000000000005"
LUDY = "6b1f2b3c-0000-4000-8000-000000000001"

passed = 0
failed = []


class DbError(Exception):
    pass


def psql(sql, role="anon", claims=None, headers=None):
    claims = claims or {"role": role}
    pre = [
        f"set role {role};" if role != "postgres" else "",
        f"select set_config('request.jwt.claims', '{json.dumps(claims)}', false);",
        f"select set_config('request.headers', '{json.dumps(headers or {'x-forwarded-for': f'10.0.{random.randint(0,255)}.{random.randint(1,254)}'})}', false);",
    ]
    proc = subprocess.run(
        ["psql", "-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", DB, "-X", "-q", "-t", "-A",
         "-v", "ON_ERROR_STOP=1", "-c", "\n".join(pre), "-c", sql],
        capture_output=True, text=True)
    if proc.returncode != 0:
        raise DbError(proc.stderr.strip())
    lines = [l for l in proc.stdout.strip().splitlines() if l.strip()]
    return lines[-1] if lines else ""


def rpc(fn, args=None, **kw):
    args = args or {}
    parts = []
    for k, v in args.items():
        if v is None:
            parts.append(f"{k} => null")
        elif isinstance(v, bool):
            parts.append(f"{k} => {'true' if v else 'false'}")
        elif isinstance(v, (int, float)):
            parts.append(f"{k} => {v}")
        elif isinstance(v, list) and v and isinstance(v[0], dict):
            parts.append(f"{k} => $j${json.dumps(v)}$j$::jsonb")
        elif isinstance(v, list):
            arr = "{" + ",".join(v) + "}"
            parts.append(f"{k} => '{arr}'::uuid[]")
        elif isinstance(v, dict):
            parts.append(f"{k} => $j${json.dumps(v)}$j$::jsonb")
        else:
            parts.append(f"{k} => $v${v}$v$")
    out = psql(f"select public.{fn}({', '.join(parts)});", **kw)
    return json.loads(out) if out and out[0] in "[{" else out


def expect_error(code, fn, *a, **kw):
    try:
        fn(*a, **kw)
    except DbError as e:
        assert code in str(e), f"esperava {code}, veio: {e}"
        return str(e)
    raise AssertionError(f"esperava erro {code}, mas a chamada funcionou")


def test(name):
    def deco(f):
        global passed
        try:
            f()
            passed += 1
            print(f"  ok  {name}")
        except Exception as e:  # noqa
            failed.append((name, e))
            print(f"  ERRO {name}: {e}")
        return f
    return deco


def next_weekday(weekday, min_days=3):
    """weekday: 0=segunda ... 6=domingo (Python). Evita feriados semeados."""
    holidays = {dt.date(2026, 11, 2), dt.date(2026, 11, 20), dt.date(2026, 12, 25), dt.date(2027, 1, 1)}
    d = dt.datetime.now(TZ).date() + dt.timedelta(days=min_days)
    while d.weekday() != weekday or d in holidays:
        d += dt.timedelta(days=1)
    return d


def at(d, hhmm):
    h, m = map(int, hhmm.split(":"))
    return dt.datetime(d.year, d.month, d.day, h, m, tzinfo=TZ).isoformat()


def slots(services, d, prof=None, **extra):
    r = rpc("get_available_slots", {"p_service_ids": services, "p_date": d.isoformat(), "p_professional_id": prof, **extra})
    return [s["time"] for s in r["slots"]]


def book(services, start, phone="35999990001", name="Cliente Teste", key=None, prof=None, email=None, **kw):
    return rpc("create_booking", {
        "p_service_ids": services, "p_start": start, "p_full_name": name, "p_phone": phone,
        "p_professional_id": prof, "p_email": email, "p_notes": None,
        "p_accept_policy": True, "p_accept_privacy": True,
        "p_idempotency_key": key or str(uuid.uuid4())}, **kw)


admin_claims = {}


def setup_admin():
    if admin_claims:
        return admin_claims
    uid = str(uuid.uuid4())
    psql(f"insert into auth.users (id, email) values ('{uid}', 'dona@example.com');"
         f"insert into public.admin_roles (user_id, role, display_name) values ('{uid}', 'owner', 'Ludy');", role="postgres")
    admin_claims.update({"role": "authenticated", "sub": uid, "email": "dona@example.com"})
    return admin_claims



WED = next_weekday(2)
THU = next_weekday(3)
SAT = next_weekday(5)
SUN = next_weekday(6)
MON = next_weekday(0)

print(f"Datas de teste: qua {WED}, qui {THU}, sáb {SAT}")


@test("site público traz catálogo, horários e dados confirmados")
def _():
    s = rpc("get_public_site")
    assert s["settings"]["whatsapp"] == "5535991260502"
    assert s["settings"]["address_line"] == "R. Bernardino Macieira, 334"
    assert len(s["services"]) == 6
    assert {h["weekday"] for h in s["business_hours"]} == {2, 3, 4, 5, 6}
    assert all("is_sample" not in x for x in s["services"]), "não deve vazar campos internos"


@test("anon não lê tabelas diretamente nem chama funções do painel")
def _():
    expect_error("permission denied", psql, "select * from public.clients;")
    expect_error("permission denied", psql, "select * from public.appointments;")
    expect_error("permission denied", rpc, "admin_dashboard")
    expect_error("permission denied", psql, "select * from private.app_secrets;")


@test("grade de quarta: manicure 50 min, passo 30 → 08:00 a 18:00")
def _():
    t = slots([MANICURE], WED)
    assert t[0] == "08:00" and t[-1] == "18:00" and len(t) == 21, t


@test("sábado 09:00–13:00; domingo e segunda fechados")
def _():
    t = slots([MANICURE], SAT)
    assert t[0] == "09:00" and t[-1] == "12:00", t
    assert slots([MANICURE], SUN) == []
    assert slots([MANICURE], MON) == []


@test("feriado semeado não tem horários")
def _():
    if dt.date(2026, 11, 20) > dt.datetime.now(TZ).date():
        assert slots([MANICURE], dt.date(2026, 11, 20)) == []


@test("calendário do mês marca dias passados e fechados como indisponíveis")
def _():
    cal = rpc("get_availability_calendar", {"p_service_ids": [MANICURE], "p_professional_id": None, "p_month": WED.isoformat()})
    days = {d["date"]: d for d in cal["days"]}
    assert days[WED.isoformat()]["available"] is True
    for d in cal["days"]:
        dd = dt.date.fromisoformat(d["date"])
        if dd.weekday() in (6, 0) or dd < dt.datetime.now(TZ).date():
            assert d["available"] is False, d
    assert cal["duration_minutes"] == 50 and cal["total_price_cents"] == 3500


@test("combinação soma duração e valor; serviço não combinável é recusado junto")
def _():
    cal = rpc("get_availability_calendar", {"p_service_ids": [MANICURE, GEL], "p_month": WED.isoformat()})
    assert cal["duration_minutes"] == 125 and cal["total_price_cents"] == 11500
    expect_error("SERVICE_UNAVAILABLE", rpc, "get_availability_calendar", {"p_service_ids": [MANICURE, ALONG]})


state = {}


@test("cria agendamento, gera protocolo e token; horário some da agenda")
def _():
    b = book([MANICURE], at(WED, "10:00"), key="k-" + "a" * 20, email="Maria@Example.com")
    assert b["protocol"].startswith("LB") and len(b["protocol"]) == 8
    assert b["status"] == "pending" and b["professional"]["name"] == "Ludy Brito"
    assert b["total_price_cents"] == 3500 and b["duration_minutes"] == 50
    assert "•" in b["client"]["phone_masked"]
    state["b1"] = b
    t = slots([MANICURE], WED)
    for gone in ("09:30", "10:00", "10:30"):
        assert gone not in t, (gone, t)
    assert "09:00" in t and "11:00" in t


@test("mesma requisição repetida (idempotência) devolve o mesmo agendamento")
def _():
    b = book([MANICURE], at(WED, "10:00"), key="k-" + "a" * 20)
    assert b["protocol"] == state["b1"]["protocol"]


@test("outra cliente no mesmo horário recebe SLOT_TAKEN")
def _():
    expect_error("SLOT_TAKEN", book, [MANICURE], at(WED, "10:00"), phone="35999990002")
    expect_error("SLOT_TAKEN", book, [MANICURE], at(WED, "10:30"), phone="35999990002")


@test("horário fora da grade é recusado (ex.: 10:15 e 18:30)")
def _():
    expect_error("SLOT_TAKEN", book, [MANICURE], at(WED, "10:15"), phone="35999990003")
    expect_error("SLOT_TAKEN", book, [MANICURE], at(WED, "18:30"), phone="35999990003")


@test("validações: telefone, nome, consentimento, e-mail")
def _():
    expect_error("INVALID_PHONE", book, [MANICURE], at(WED, "15:00"), phone="1234")
    expect_error("INVALID_NAME", book, [MANICURE], at(WED, "15:00"), name="A")
    expect_error("INVALID_EMAIL", book, [MANICURE], at(WED, "15:00"), email="sem-arroba")
    expect_error("CONSENT_REQUIRED", rpc, "create_booking", {
        "p_service_ids": [MANICURE], "p_start": at(WED, "15:00"), "p_full_name": "Fulana de Tal",
        "p_phone": "35999990004", "p_accept_policy": False, "p_accept_privacy": True})


@test("consulta exige token correto")
def _():
    b = state["b1"]
    expect_error("BOOKING_NOT_FOUND", rpc, "get_booking", {"p_protocol": b["protocol"], "p_token": "0" * 40})
    expect_error("BOOKING_NOT_FOUND", rpc, "get_booking", {"p_protocol": b["protocol"], "p_token": None})
    g = rpc("get_booking", {"p_protocol": b["protocol"].lower(), "p_token": b["token"]})
    assert g["protocol"] == b["protocol"] and g["can_cancel"] is True


@test("reagendar libera o horário antigo e ocupa o novo")
def _():
    b = state["b1"]
    t = slots([MANICURE], WED, p_protocol=b["protocol"], p_token=b["token"])
    assert "10:00" in t, "no reagendamento o próprio horário aparece livre"
    r = rpc("reschedule_booking", {"p_protocol": b["protocol"], "p_token": b["token"], "p_new_start": at(WED, "14:00")})
    assert r["starts_at"].startswith(WED.isoformat()) and "14:00" not in slots([MANICURE], WED)
    assert "10:00" in slots([MANICURE], WED)


@test("bloqueio 14h–16h tira todos os horários afetados")
def _():
    owner = setup_admin()
    rpc("admin_create_block", {"p_professional_id": None, "p_starts_at": at(THU, "14:00"), "p_ends_at": at(THU, "16:00"),
                               "p_kind": "block", "p_reason": "teste"}, role="authenticated", claims=owner)
    t = slots([MANICURE], THU)
    for gone in ("13:30", "14:00", "14:30", "15:00", "15:30"):
        assert gone not in t, (gone, t)
    assert "13:00" in t and "16:00" in t


@test("cancelar libera o horário; cancelar de novo é recusado")
def _():
    b = state["b1"]
    r = rpc("cancel_booking", {"p_protocol": b["protocol"], "p_token": b["token"], "p_reason": "imprevisto"})
    assert r["status"] == "cancelled" and "14:00" in slots([MANICURE], WED)
    expect_error("NOT_CANCELLABLE", rpc, "cancel_booking", {"p_protocol": b["protocol"], "p_token": b["token"]})


@test("prazo de cancelamento é respeitado")
def _():
    owner = setup_admin()
    rpc("admin_save_rules", {"p": {"min_advance_minutes": 0}}, role="authenticated", claims=owner)
    soon = dt.datetime.now(TZ) + dt.timedelta(days=1)
    # agenda pelo painel um horário perto (dentro das 12h? usa regra de 48h para forçar)
    rpc("admin_save_rules", {"p": {"min_advance_minutes": 120}}, role="authenticated", claims=owner)
    b = book([MANICURE], at(SAT, "09:00"), phone="35999990010")
    rpc("admin_save_rules", {"p": {"cancel_min_hours": 24 * 30, "reschedule_min_hours": 24 * 30}}, role="authenticated", claims=owner)
    expect_error("CANCEL_WINDOW_CLOSED", rpc, "cancel_booking", {"p_protocol": b["protocol"], "p_token": b["token"]})
    expect_error("RESCHEDULE_WINDOW_CLOSED", rpc, "reschedule_booking",
                 {"p_protocol": b["protocol"], "p_token": b["token"], "p_new_start": at(SAT, "11:00")})
    rpc("admin_save_rules", {"p": {"cancel_min_hours": 12, "reschedule_min_hours": 12}}, role="authenticated", claims=owner)
    assert soon  # noqa


@test("limite de tentativas por telefone")
def _():
    phone = "35999990020"
    for hh in ("08:00", "09:00", "11:00", "12:00"):
        book([MANICURE], at(THU, hh), phone=phone)
    expect_error("RATE_LIMITED", book, [MANICURE], at(THU, "17:00"), phone=phone)


@test("segunda profissional com escala própria: 'qualquer profissional' soma as agendas")
def _():
    owner = setup_admin()
    p = rpc("admin_save_professional", {"p": {"name": "Profissional Teste", "service_ids": [MANICURE],
            "schedule": [{"weekday": 3, "start": "13:00", "end": "17:00"}]}}, role="authenticated", claims=owner)
    state["p2"] = p["id"]
    only_p2 = slots([MANICURE], WED, prof=p["id"])
    assert only_p2[0] == "13:00" and only_p2[-1] == "16:00", only_p2
    assert slots([MANICURE], THU, prof=p["id"]) == [], "escala só na quarta"
    # ocupa a Ludy às 15:00 na quarta; com 'qualquer', 15:00 continua disponível pela segunda profissional
    book([MANICURE], at(WED, "15:00"), phone="35999990030", prof=LUDY)
    assert "15:00" in slots([MANICURE], WED)
    b = book([MANICURE], at(WED, "15:00"), phone="35999990031")
    assert b["professional"]["id"] == p["id"]
    assert "15:00" not in slots([MANICURE], WED)
    expect_error("PROFESSIONAL_UNAVAILABLE", slots, [GEL], WED, prof=p["id"])


@test("concorrência: 8 clientes no mesmo horário ao mesmo tempo → 1 confirmação")
def _():
    start = at(next_weekday(4, min_days=10), "10:00")  # sexta
    def attempt(i):
        try:
            book([MANICURE], start, phone=f"3598888{i:04d}", prof=LUDY,
                 headers={"x-forwarded-for": f"10.1.0.{i}"})
            return "ok"
        except DbError as e:
            return "taken" if "SLOT_TAKEN" in str(e) else str(e)
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(attempt, range(8)))
    assert results.count("ok") == 1 and results.count("taken") == 7, results
    n = psql(f"select count(*) from appointments where starts_at = '{start}' and status <> 'cancelled' "
             f"and professional_id = '{LUDY}'", role="postgres")
    assert n == "1", n


@test("restrição do banco impede sobreposição mesmo inserindo direto")
def _():
    expect_error("appointments_no_overlap", psql, f"""
      insert into appointments (protocol, client_id, professional_id, starts_at, ends_at, blocked_until, total_duration_minutes)
      select 'LBTEST01', client_id, professional_id, starts_at + interval '10 min', ends_at + interval '10 min', blocked_until + interval '10 min', 50
      from appointments where status <> 'cancelled' and professional_id = '{LUDY}' limit 1;""", role="postgres")


@test("área da cliente por e-mail (OTP) lista os próprios agendamentos")
def _():
    b = book([GEL], at(SAT, "10:00"), phone="35999990040", email="ana@example.com")
    uid = str(uuid.uuid4())
    me = rpc("my_appointments", role="authenticated", claims={"role": "authenticated", "sub": uid, "email": "ana@example.com"})
    assert [x["protocol"] for x in me["upcoming"]] == [b["protocol"]]
    other = rpc("my_appointments", role="authenticated", claims={"role": "authenticated", "sub": uid, "email": "outra@example.com"})
    assert other["upcoming"] == []
    expect_error("permission denied", rpc, "my_appointments")


@test("usuária autenticada sem papel não acessa o painel")
def _():
    c = {"role": "authenticated", "sub": str(uuid.uuid4()), "email": "x@example.com"}
    expect_error("FORBIDDEN", rpc, "admin_dashboard", role="authenticated", claims=c)


@test("painel: dashboard, lista com busca/filtro/paginação, detalhe")
def _():
    a = setup_admin()
    d = rpc("admin_dashboard", role="authenticated", claims=a)
    assert d["counts"]["clients"] >= 5 and isinstance(d["daily"], list) and len(d["daily"]) == 27
    lst = rpc("admin_list_appointments", {"p_search": "Cliente", "p_limit": 3, "p_offset": 0}, role="authenticated", claims=a)
    assert lst["total"] >= 5 and len(lst["rows"]) == 3
    page2 = rpc("admin_list_appointments", {"p_search": "Cliente", "p_limit": 3, "p_offset": 3}, role="authenticated", claims=a)
    assert {r["id"] for r in lst["rows"]}.isdisjoint({r["id"] for r in page2["rows"]})
    canc = rpc("admin_list_appointments", {"p_statuses": "{cancelled}"}, role="authenticated", claims=a)
    assert canc["total"] >= 1 and all(r["status"] == "cancelled" for r in canc["rows"])
    det = rpc("admin_get_appointment", {"p_id": lst["rows"][0]["id"]}, role="authenticated", claims=a)
    assert det["history"], "histórico de auditoria"


@test("painel: cria, confirma, conclui, registra ausência e reativa com checagem de conflito")
def _():
    a = setup_admin()
    r = rpc("admin_save_appointment", {"p_id": None, "p_service_ids": [GEL], "p_professional_id": LUDY,
            "p_start": at(SAT, "11:30"), "p_client_name": "Cliente Balcão", "p_client_phone": "(35) 98877-6655",
            "p_admin_notes": "veio pelo Instagram"}, role="authenticated", claims=a)
    assert r["status"] == "confirmed" and r["source"] == "admin"
    expect_error("SLOT", rpc, "admin_save_appointment", {"p_id": None, "p_service_ids": [MANICURE], "p_professional_id": LUDY,
            "p_start": at(SAT, "12:00"), "p_client_name": "Outra", "p_client_phone": "35988776656"}, role="authenticated", claims=a)
    # encaixe fora da grade permitido quando não há conflito
    enc = rpc("admin_save_appointment", {"p_id": None, "p_service_ids": [MANICURE], "p_professional_id": LUDY,
            "p_start": at(SAT, "13:30"), "p_client_name": "Encaixe", "p_client_phone": "35988776657",
            "p_outside_hours": True}, role="authenticated", claims=a)
    assert enc["status"] == "confirmed"
    for s in ("completed", "no_show", "cancelled"):
        x = rpc("admin_set_appointment_status", {"p_id": r["id"], "p_status": s, "p_reason": "teste"}, role="authenticated", claims=a)
        assert x["status"] == s
    # ocupa o horário e tenta reativar
    rpc("admin_save_appointment", {"p_id": None, "p_service_ids": [GEL], "p_professional_id": LUDY,
        "p_start": at(SAT, "11:30"), "p_client_name": "Nova", "p_client_phone": "35988776658"}, role="authenticated", claims=a)
    expect_error("SLOT_TAKEN", rpc, "admin_set_appointment_status", {"p_id": r["id"], "p_status": "confirmed"}, role="authenticated", claims=a)
    n = rpc("admin_set_appointment_notes", {"p_id": r["id"], "p_notes": "anotação"}, role="authenticated", claims=a)
    assert n["admin_notes"] == "anotação"


@test("painel: serviços (criar, editar, desativar, excluir só sem histórico) aparecem no site")
def _():
    a = setup_admin()
    s = rpc("admin_save_service", {"p": {"name": "Spa dos pés", "category_id": "5c000000-0000-4000-8000-000000000002",
            "duration_minutes": 45, "price_cents": 5500, "professional_ids": [LUDY]}}, role="authenticated", claims=a)
    assert s["slug"] == "spa-dos-pes" and s["is_sample"] is False
    assert any(x["name"] == "Spa dos pés" for x in rpc("get_public_site")["services"])
    s2 = rpc("admin_save_service", {"p": {**s, "price_cents": 6000, "active": False, "professional_ids": [LUDY]}}, role="authenticated", claims=a)
    assert s2["price_cents"] == 6000
    assert not any(x["name"] == "Spa dos pés" for x in rpc("get_public_site")["services"])
    rpc("admin_delete_service", {"p_id": s["id"]}, role="authenticated", claims=a)
    expect_error("SERVICE_IN_USE", rpc, "admin_delete_service", {"p_id": MANICURE}, role="authenticated", claims=a)
    cat = rpc("admin_list_catalog", role="authenticated", claims=a)
    assert len(cat["services"]) == 6


@test("painel: horários, regras, exceções e férias")
def _():
    a = setup_admin()
    cfg = rpc("admin_get_availability_config", role="authenticated", claims=a)
    hours = cfg["business_hours"]
    lunch = [h for h in hours if h["weekday"] != 3] + [{"weekday": 3, "start": "08:00", "end": "12:00"},
                                                       {"weekday": 3, "start": "13:00", "end": "19:00"}]
    rpc("admin_save_business_hours", {"p": lunch}, role="authenticated", claims=a)
    t = slots([MANICURE], next_weekday(2, min_days=10), prof=LUDY)
    assert "11:00" in t and "11:30" not in t and "12:00" not in t and "13:00" in t, t
    expect_error("OVERLAPPING_HOURS", rpc, "admin_save_business_hours",
                 {"p": [{"weekday": 1, "start": "08:00", "end": "12:00"}, {"weekday": 1, "start": "11:00", "end": "13:00"}]},
                 role="authenticated", claims=a)
    rpc("admin_save_business_hours", {"p": hours}, role="authenticated", claims=a)
    d = next_weekday(1, min_days=10)
    rpc("admin_save_exception", {"p": {"date": d.isoformat(), "kind": "custom_hours", "start": "10:00", "end": "12:00", "reason": "evento"}},
        role="authenticated", claims=a)
    t = slots([MANICURE], d, prof=LUDY)
    assert t == ["10:00", "10:30", "11:00"], t
    v1 = next_weekday(4, min_days=20)
    r = rpc("admin_create_block", {"p_professional_id": LUDY, "p_starts_at": at(v1, "00:00"),
            "p_ends_at": at(v1 + dt.timedelta(days=7), "00:00"), "p_kind": "vacation", "p_reason": "férias"}, role="authenticated", claims=a)
    assert slots([MANICURE], v1, prof=LUDY) == []
    rpc("admin_delete_block", {"p_id": r["id"]}, role="authenticated", claims=a)
    assert slots([MANICURE], v1, prof=LUDY) != []


@test("painel: clientes, calendário, relatórios, exportação, configurações e auditoria")
def _():
    a = setup_admin()
    cl = rpc("admin_list_clients", {"p_search": "9999"}, role="authenticated", claims=a)
    assert cl["total"] >= 3
    rec = rpc("admin_list_clients", {"p_filter": "recurring"}, role="authenticated", claims=a)
    assert all(r["visits"] >= 2 for r in rec["rows"])
    c = rpc("admin_get_client", {"p_id": cl["rows"][0]["id"]}, role="authenticated", claims=a)
    assert "appointments" in c
    cal = rpc("admin_calendar", {"p_from": WED.isoformat(), "p_to": (WED + dt.timedelta(days=6)).isoformat()}, role="authenticated", claims=a)
    assert cal["appointments"] and cal["hours"]
    today = dt.datetime.now(TZ).date()
    rep = rpc("admin_reports", {"p_from": today.isoformat(), "p_to": (today + dt.timedelta(days=60)).isoformat()}, role="authenticated", claims=a)
    assert rep["totals"]["total"] >= 5 and rep["by_service"]
    exp = rpc("admin_export_appointments", {"p_from": today.isoformat(), "p_to": (today + dt.timedelta(days=60)).isoformat()},
              role="authenticated", claims=a)
    assert exp and {"protocolo", "cliente", "valor", "status"} <= set(exp[0])
    st = rpc("admin_save_settings", {"p": {"tagline": "Mais que unhas: uma experiência de cuidado.", "notify_email_enabled": False}},
             role="authenticated", claims=a)
    assert st["whatsapp"] == "5535991260502"
    expect_error("INVALID_PHONE", rpc, "admin_save_settings", {"p": {"whatsapp": "123"}}, role="authenticated", claims=a)
    log = rpc("admin_audit_log", role="authenticated", claims=a)
    assert any(x["action"] == "settings.saved" for x in log)


@test("perfil 'staff' não altera configurações nem serviços")
def _():
    uid = str(uuid.uuid4())
    psql(f"insert into auth.users (id, email) values ('{uid}', 'equipe@example.com');"
         f"insert into public.admin_roles (user_id, role) values ('{uid}', 'staff');", role="postgres")
    c = {"role": "authenticated", "sub": uid, "email": "equipe@example.com"}
    rpc("admin_dashboard", role="authenticated", claims=c)
    expect_error("FORBIDDEN", rpc, "admin_save_settings", {"p": {"tagline": "x"}}, role="authenticated", claims=c)
    expect_error("FORBIDDEN", rpc, "admin_save_service", {"p": {"name": "X", "duration_minutes": 30}}, role="authenticated", claims=c)


@test("notificações: nada é enfileirado sem canal configurado; com e-mail ativo, sem duplicar")
def _():
    a = setup_admin()
    before = int(psql("select count(*) from notifications", role="postgres"))
    assert before == 0, "com canais desligados não há envio simulado"
    rpc("admin_save_settings", {"p": {"notify_email_enabled": True, "notify_owner_email": "dona@example.com"}}, role="authenticated", claims=a)
    b = book([MANICURE], at(THU, "18:00"), phone="35999990050", email="bea@example.com")
    n = psql("select count(*) from notifications", role="postgres")
    assert n == "2", n  # cliente + proprietária
    psql("select public.enqueue_due_reminders(); select public.enqueue_due_reminders();", role="postgres")
    psql("select 1", role="postgres")
    dup = psql("select count(*) - count(distinct dedupe_key) from notifications", role="postgres")
    assert dup == "0"
    rpc("admin_save_settings", {"p": {"notify_email_enabled": False}}, role="authenticated", claims=a)
    assert b


print()
print(f"{passed} passaram, {len(failed)} falharam")
sys.exit(1 if failed else 0)
