#!/usr/bin/env python3
"""Gera as versões otimizadas (AVIF + WebP + JPEG fallback) das fotos do studio.
Uso: python3 tools/images.py <pasta-dos-originais>
Recortes por proporção com ponto focal (fx, fy em 0..1). Nunca amplia além do original.
"""
import json, os, sys
from PIL import Image, ImageOps

SRC = sys.argv[1] if len(sys.argv) > 1 else "originais"
OUT = os.path.join(os.path.dirname(__file__), "..", "site", "images")
WIDTHS = (480, 800, 1200, 1800)

# nome de saída: (arquivo original, proporção w/h ou None, foco x, foco y)
PLAN = {
  "hero/retrato-azul":        ("ludybrito_DZ99EwWkdFg_1.jpg", 3/4, .5, .45),
  "hero/detalhe-preto":       ("ludybrito_DbCSWlEhdLS_1.jpg", 1/1, .5, .5),
  "hero/pes-francesinha":     ("ludybrito_DaiegeTh7WE_1.jpg", 16/10, .5, .78),
  "gallery/azul-glitter-retrato":  ("ludybrito_DZ99EwWkdFg_1.jpg", None, .5, .5),
  "gallery/azul-glitter-maos":     ("ludybrito_DZ99EwWkdFg_2.jpg", None, .5, .5),
  "gallery/azul-glitter-detalhe":  ("ludybrito_DZ99EwWkdFg_3.jpg", None, .5, .5),
  "gallery/preto-francesinha-dourada": ("ludybrito_DbCSWlEhdLS_1.jpg", None, .5, .5),
  "gallery/alongamento-nude-pontos":   ("ludybrito_Dd7cYQ9BtZ4_1.jpg", None, .5, .5),
  "gallery/marsala":               ("ludybrito_DafeXW5RXgJ_1.jpg", None, .5, .5),
  "gallery/pes-gel-francesinha":   ("ludybrito_DaiegeTh7WE_1.jpg", None, .5, .5),
  "gallery/pes-branco-paisagem":   ("ludybrito_collab_isabella_DexQp1lBkjP_1.jpg", 3/2, .5, .5),
  "gallery/pes-branco":            ("ludybrito_collab_isabella_DexQp1lBkjP_1.jpg", None, .5, .5),
  "services/manicure":             ("ludybrito_DafeXW5RXgJ_1.jpg", 4/5, .5, .62),
  "services/esmaltacao-em-gel":    ("ludybrito_DZ99EwWkdFg_2.jpg", 4/5, .5, .4),
  "services/pedicure":             ("ludybrito_collab_isabella_DexQp1lBkjP_1.jpg", 4/5, .5, .55),
  "services/esmaltacao-em-gel-nos-pes": ("ludybrito_DaiegeTh7WE_1.jpg", 4/5, .5, .7),
  "services/alongamento-em-gel":   ("ludybrito_Dd7cYQ9BtZ4_1.jpg", 4/5, .5, .5),
  "services/manutencao-de-alongamento": ("ludybrito_DbCSWlEhdLS_1.jpg", 4/5, .5, .5),
  "studio/maos-azul-paisagem":      ("ludybrito_DZ99EwWkdFg_2.jpg", 16/10, .5, .42),
  "studio/detalhe-azul-close":      ("ludybrito_DZ99EwWkdFg_3.jpg", 4/5, .4, .3),
  "backgrounds/maos-azul-faixa":   ("ludybrito_DZ99EwWkdFg_3.jpg", 9/16, .5, .35),
}

def crop(im, ratio, fx, fy):
    if ratio is None:
        return im
    w, h = im.size
    if w / h > ratio:
        nw = round(h * ratio); x = min(max(round(fx * w - nw / 2), 0), w - nw)
        return im.crop((x, 0, x + nw, h))
    nh = round(w / ratio); y = min(max(round(fy * h - nh / 2), 0), h - nh)
    return im.crop((0, y, w, y + nh))

manifest = {}
for name, (src, ratio, fx, fy) in PLAN.items():
    im = ImageOps.exif_transpose(Image.open(os.path.join(SRC, src))).convert("RGB")
    im = crop(im, ratio, fx, fy)
    base = os.path.join(OUT, name)
    os.makedirs(os.path.dirname(base), exist_ok=True)
    made = []
    for w in WIDTHS:
        tw = min(w, im.width)
        if made and tw == made[-1]:
            continue
        r = im.resize((tw, round(im.height * tw / im.width)), Image.LANCZOS) if tw < im.width else im
        r.save(f"{base}-{w}.avif", quality=58)
        r.save(f"{base}-{w}.webp", quality=78, method=6)
        made.append(tw)
    im.resize((min(1200, im.width), round(im.height * min(1200, im.width) / im.width)), Image.LANCZOS).save(f"{base}.jpg", quality=82, optimize=True, progressive=True)
    manifest[name] = {"w": im.width, "h": im.height, "widths": list(WIDTHS[:len(made)])}
json.dump(manifest, open(os.path.join(OUT, "manifest.json"), "w"), indent=1)
print(len(manifest), "imagens")
