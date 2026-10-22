#!/usr/bin/env python3
"""Capturas de tela para revisão: python3 tests/e2e/shot.py <caminho> <larguras,...> [--full] [--out pasta]"""
import sys, os
from playwright.sync_api import sync_playwright
path = sys.argv[1]
widths = [int(w) for w in sys.argv[2].split(",")]
full = "--full" in sys.argv
out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "/tmp/claude-0/-home-claude/06c548a8-6466-5da1-9723-26c9a7482670/scratchpad/shots"
os.makedirs(out, exist_ok=True)
base = os.environ.get("BASE", "http://localhost:8787")
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get("CHROME", "/opt/pw-browsers/chromium"), args=["--no-sandbox"]) if os.path.exists("/opt/pw-browsers/chromium") else p.chromium.launch()
    for w in widths:
        h = 900 if w >= 1024 else (1024 if w >= 768 else 812)
        pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=1, reduced_motion="reduce")
        errs = []
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(base + path, wait_until="load")
        pg.wait_for_timeout(800)
        pg.wait_for_timeout(400)
        if full:
            pg.evaluate("""async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); } window.scrollTo(0, 0); }""")
            pg.wait_for_timeout(1500)
        sw = pg.evaluate("document.documentElement.scrollWidth")
        name = f"{out}/{path.strip('/').replace('/', '_') or 'home'}-{w}.png"
        pg.screenshot(path=name, full_page=full)
        print(name, "scrollWidth", sw, "erros:", errs[:5])
        pg.close()
    b.close()
