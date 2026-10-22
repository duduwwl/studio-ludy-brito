#!/usr/bin/env python3
"""Servidor local que imita o Supabase (RPC do PostgREST, Auth e Storage) sobre o PostgreSQL de teste
e serve a pasta site/. Serve apenas para testes automatizados e revisão local — não usar em produção.

Uso: python3 tests/mock/server.py [porta]   (padrão 8787; banco em PGPORT/TEST_DB)
Rotas de apoio a testes: GET /__test/otp?email=…  GET /__test/recovery?email=…  POST /__test/sql
"""
import base64
import json
import mimetypes
import os
import random
import re
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
PGPORT = os.environ.get("PGPORT", "54329")
DB = os.environ.get("TEST_DB", "ludy_test")
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.abspath(os.path.join(HERE, "..", "..", "site"))
UPLOADS = os.path.join(HERE, "uploads")
ANON = "anon-key-local"
otps, recoveries, refresh = {}, {}, {}
lock = threading.Lock()
SIG_CACHE = {}


def psql(sql, claims=None, headers=None, role=None):
    pre = ""
    if role:
        pre += f"set role {role};"
    pre += ("do $d$ begin perform set_config('request.jwt.claims', $c${}$c$, false); "
            "perform set_config('request.headers', $h${}$h$, false); end $d$;").format(
        json.dumps(claims or {"role": "anon"}), json.dumps(headers or {}))
    p = subprocess.run(["psql", "-h", "/tmp", "-p", PGPORT, "-U", "postgres", "-d", DB, "-X", "-q", "-t", "-A",
                        "-v", "ON_ERROR_STOP=1", "-c", pre, "-c", sql], capture_output=True, text=True)
    if p.returncode:
        raise RuntimeError(p.stderr)
    lines = [l for l in p.stdout.splitlines() if l.strip()]
    return lines[-1] if lines else ""


def signature(fn):
    if fn in SIG_CACHE:
        return SIG_CACHE[fn]
    out = psql(f"""select coalesce(json_agg(json_build_object('name', n, 'type', t) order by o), '[]') from (
      select unnest(proargnames) n, unnest(string_to_array(oidvectortypes(proargtypes), ', ')) t,
             generate_subscripts(proargnames, 1) o
      from pg_proc where proname = '{fn}' and pronamespace = 'public'::regnamespace) x""")
    sig = json.loads(out) if out else []
    SIG_CACHE[fn] = sig
    return sig


def cast(name, typ):
    j = f"(select j from a)"
    if typ.endswith("[]"):
        base = typ[:-2]
        return (f"(case when jsonb_typeof({j}->'{name}') = 'array' then (select array_agg(x::{base}) "
                f"from jsonb_array_elements_text({j}->'{name}') x) end)")
    if typ == "jsonb":
        return f"({j}->'{name}')"
    return f"({j}->>'{name}')::{typ}"


def jwt(payload):
    enc = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")
    return f"{enc({'alg': 'none'})}.{enc(payload)}.mock"


def claims_from(token):
    if not token or token == ANON:
        return {"role": "anon"}
    try:
        part = token.split(".")[1]
        data = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
        if data.get("exp", 0) < time.time():
            return None
        return data
    except Exception:
        return None


def session_for(user_id, email):
    payload = {"sub": user_id, "email": email, "role": "authenticated", "exp": int(time.time()) + 3600}
    rt = uuid.uuid4().hex
    refresh[rt] = (user_id, email)
    return {"access_token": jwt(payload), "token_type": "bearer", "expires_in": 3600,
            "expires_at": payload["exp"], "refresh_token": rt, "user": {"id": user_id, "email": email}}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        if os.environ.get("MOCK_VERBOSE"):
            super().log_message(*a)

    def send(self, status, body=None, ctype="application/json", extra=None):
        data = b"" if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def do_OPTIONS(self):
        self.send(204, None, extra={"Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*"})

    # ------------------------------------------------------------------ roteamento
    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/__test/otp":
            return self.send(200, {"code": otps.get(parse_qs(u.query)["email"][0].lower())})
        if u.path == "/__test/recovery":
            return self.send(200, {"token": recoveries.get(parse_qs(u.query)["email"][0].lower())})
        if u.path.startswith("/storage/v1/object/public/media/"):
            f = os.path.join(UPLOADS, unquote(u.path.split("/media/", 1)[1]))
            if not os.path.abspath(f).startswith(UPLOADS) or not os.path.isfile(f):
                return self.send(404, {"error": "not found"})
            return self.send(200, open(f, "rb").read(), mimetypes.guess_type(f)[0] or "application/octet-stream")
        if u.path == "/assets/js/config.js" or u.path.endswith("/assets/js/config.js"):
            js = ("window.LB_CONFIG = { supabaseUrl: location.origin, supabaseAnonKey: '%s', sessionKey: 'lb.session' };" % ANON)
            return self.send(200, js.encode(), "text/javascript")
        return self.static(u.path)

    do_HEAD = do_GET

    def do_POST(self):
        u = urlparse(self.path)
        if u.path.startswith("/rest/v1/rpc/"):
            return self.rpc(u.path.rsplit("/", 1)[1])
        if u.path.startswith("/auth/v1/"):
            return self.auth(u.path[len("/auth/v1/"):], parse_qs(u.query))
        if u.path.startswith("/storage/v1/object/media/"):
            return self.upload(unquote(u.path.split("/media/", 1)[1]))
        if u.path == "/__test/sql":
            try:
                return self.send(200, {"out": psql(self.body().decode(), role=None)})
            except RuntimeError as e:
                return self.send(400, {"error": str(e)})
        self.send(404, {"error": "not found"})

    def do_PUT(self):
        u = urlparse(self.path)
        if u.path == "/auth/v1/user":
            return self.auth("user", {})
        self.send(404, {"error": "not found"})

    # ------------------------------------------------------------------ estáticos
    def static(self, path):
        rel = unquote(path).lstrip("/")
        f = os.path.abspath(os.path.join(SITE, rel))
        if not f.startswith(SITE):
            return self.send(403, {"error": "forbidden"})
        if os.path.isdir(f):
            if not path.endswith("/"):
                return self.send(301, None, extra={"Location": path + "/"})
            f = os.path.join(f, "index.html")
        if not os.path.isfile(f):
            nf = os.path.join(SITE, "404.html")
            return self.send(404, open(nf, "rb").read() if os.path.isfile(nf) else b"404", "text/html; charset=utf-8")
        ctype = mimetypes.guess_type(f)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript",):
            ctype += "; charset=utf-8"
        self.send(200, open(f, "rb").read(), ctype)

    # ------------------------------------------------------------------ RPC
    def token(self):
        h = self.headers.get("Authorization", "")
        return h[7:] if h.startswith("Bearer ") else None

    def rpc(self, fn):
        if not re.fullmatch(r"[a-z_]+", fn):
            return self.send(404, {"message": "not found"})
        claims = claims_from(self.token())
        if claims is None:
            return self.send(401, {"code": "PGRST301", "message": "JWT expired"})
        try:
            args = json.loads(self.body() or b"{}")
        except ValueError:
            return self.send(400, {"message": "invalid json"})
        sig = signature(fn)
        if not sig and fn not in ("get_public_site", "admin_me", "admin_dashboard", "my_appointments", "admin_list_catalog",
                                  "admin_list_professionals", "admin_get_availability_config", "admin_get_settings",
                                  "admin_audit_log", "enqueue_due_reminders"):
            pass
        types = {s["name"]: s["type"] for s in sig}
        unknown = [k for k in args if k not in types]
        if unknown:
            return self.send(404, {"code": "PGRST202", "message": f"Could not find the function public.{fn} with {unknown}"})
        call = ", ".join(f"{k} => {cast(k, types[k])}" for k in args)
        sql = "with a as (select $J${}$J$::jsonb j) select public.{}({})::text".format(json.dumps(args), fn, call)
        role = "authenticated" if claims.get("role") == "authenticated" else "anon"
        ip = self.headers.get("X-Test-IP") or self.client_address[0]
        try:
            out = psql(sql, claims, {"x-forwarded-for": ip}, role=role)
        except RuntimeError as e:
            return self.pg_error(str(e), role)
        body = out.encode() if out else b"null"
        self.send(200, body)

    def pg_error(self, err, role):
        m = re.search(r"ERROR:\s+(.+)", err)
        d = re.search(r"DETAIL:\s+(.+)", err)
        msg = m.group(1).strip() if m else "error"
        if "permission denied" in msg:
            return self.send(401 if role == "anon" else 403, {"code": "42501", "message": msg, "details": None})
        if msg in ("FORBIDDEN", "NOT_AUTHENTICATED"):
            return self.send(403, {"code": "42501", "message": msg, "details": d.group(1).strip() if d else None})
        code = "P0001" if re.fullmatch(r"[A-Z_]+", msg) else "XX000"
        status = 400
        self.send(status, {"code": code, "message": msg, "details": d.group(1).strip() if d else None, "hint": None})

    # ------------------------------------------------------------------ Auth
    def auth(self, path, query):
        data = json.loads(self.body() or b"{}") if self.command in ("POST", "PUT") else {}
        if path.startswith("token"):
            grant = query.get("grant_type", [""])[0] or path.split("grant_type=")[-1]
            if grant == "password":
                email = (data.get("email") or "").lower()
                pw = (data.get("password") or "").replace("'", "''")
                out = psql(f"select id from auth.users where lower(email) = $e${email}$e$ "
                           f"and encrypted_password = extensions.crypt('{pw}', encrypted_password)")
                if not out:
                    return self.send(400, {"error": "invalid_grant", "error_code": "invalid_credentials",
                                           "msg": "Invalid login credentials"})
                return self.send(200, session_for(out, email))
            if grant == "refresh_token":
                rt = data.get("refresh_token")
                if rt not in refresh:
                    return self.send(400, {"error_code": "refresh_token_not_found"})
                uid, email = refresh.pop(rt)
                return self.send(200, session_for(uid, email))
        if path == "otp":
            email = (data.get("email") or "").lower()
            if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
                return self.send(400, {"error_code": "validation_failed", "msg": "E-mail inválido"})
            otps[email] = f"{random.randint(0, 999999):06d}"
            return self.send(200, {})
        if path == "verify":
            email = (data.get("email") or "").lower()
            if not email or otps.get(email) != data.get("token"):
                return self.send(403, {"error_code": "otp_expired", "msg": "Token has expired or is invalid"})
            otps.pop(email, None)
            uid = psql(f"insert into auth.users (email, email_confirmed_at) values ($e${email}$e$, now()) "
                       f"on conflict (email) do update set email_confirmed_at = now() returning id")
            return self.send(200, session_for(uid, email))
        if path == "recover":
            email = (data.get("email") or "").lower()
            uid = psql(f"select id from auth.users where lower(email) = $e${email}$e$")
            if uid:
                recoveries[email] = session_for(uid, email)["access_token"]
            return self.send(200, {})
        if path == "user":
            claims = claims_from(self.token())
            if not claims or claims.get("role") != "authenticated":
                return self.send(401, {"msg": "not authenticated"})
            pw = (data.get("password") or "")
            if len(pw) < 8:
                return self.send(422, {"error_code": "weak_password", "msg": "A senha precisa ter pelo menos 8 caracteres."})
            psql("update auth.users set encrypted_password = extensions.crypt($p${}$p$, extensions.gen_salt('bf')) "
                 "where id = '{}'".format(pw, claims["sub"]))
            return self.send(200, {"id": claims["sub"], "email": claims.get("email")})
        if path == "logout":
            return self.send(204, None)
        self.send(404, {"msg": "not found"})

    # ------------------------------------------------------------------ Storage
    def upload(self, name):
        claims = claims_from(self.token())
        if not claims or claims.get("role") != "authenticated":
            return self.send(403, {"error": "unauthorized"})
        if not psql(f"select 1 from public.admin_roles where user_id = '{claims['sub']}'"):
            return self.send(403, {"error": "unauthorized"})
        f = os.path.abspath(os.path.join(UPLOADS, name))
        if not f.startswith(UPLOADS):
            return self.send(400, {"error": "bad path"})
        os.makedirs(os.path.dirname(f), exist_ok=True)
        open(f, "wb").write(self.body())
        self.send(200, {"Key": f"media/{name}"})


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"mock Supabase + site em http://localhost:{PORT}  (banco {DB})", flush=True)
    srv.serve_forever()
