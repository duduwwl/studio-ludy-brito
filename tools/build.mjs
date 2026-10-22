#!/usr/bin/env node
// Monta as páginas estáticas de /src em /site, sem dependências.
// Cada página em src/pages começa com um comentário de metadados:
//   <!--meta {"title": "...", "description": "...", "nav": "servicos", "scripts": ["site"]} -->
// Uso: node tools/build.mjs        (gera site/)
//      SITE_URL=https://exemplo.com.br node tools/build.mjs   (URL canônica usada em SEO)

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const OUT = join(ROOT, 'site');
const business = JSON.parse(readFileSync(join(SRC, 'business.json'), 'utf8'));
const SITE_URL = (process.env.SITE_URL || business.siteUrl || '').replace(/\/$/, '');
const VERSION = Date.now().toString(36);

const partials = {};
for (const f of readdirSync(join(SRC, 'partials'))) {
  partials[f.replace(/\.html$/, '')] = readFileSync(join(SRC, 'partials', f), 'utf8');
}

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.html') ? [p] : [];
  });
}

const manifest = JSON.parse(readFileSync(join(OUT, 'images', 'manifest.json'), 'utf8'));

// [[img src="hero/retrato-azul" alt="..." sizes="50vw" class="x" eager]] → <picture> com AVIF + WebP
function picture(attrs, root) {
  const a = {};
  attrs.replace(/([\w-]+)(?:="([^"]*)")?/g, (_, k, v) => { a[k] = v ?? true; return ''; });
  const m = manifest[a.src];
  if (!m) throw new Error(`imagem não encontrada no manifest: ${a.src}`);
  if (a.alt === undefined) throw new Error(`imagem sem alt: ${a.src}`);
  const set = (ext) => m.widths.map((w) => `${root}images/${a.src}-${w}.${ext} ${Math.min(w, m.w)}w`).join(', ');
  const sizes = a.sizes || '100vw';
  const mid = m.widths[Math.min(1, m.widths.length - 1)];
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<picture${a.class ? ` class="${a.class}"` : ''}>` +
    `<source type="image/avif" srcset="${set('avif')}" sizes="${sizes}">` +
    `<img src="${root}images/${a.src}-${mid}.webp" srcset="${set('webp')}" sizes="${sizes}" width="${m.w}" height="${m.h}"` +
    `${a.eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async" alt="${esc(a.alt)}"${a.imgclass ? ` class="${a.imgclass}"` : ''}>` +
    `</picture>`;
}

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

function render(tpl, ctx, depth = 0) {
  if (depth > 8) throw new Error('include recursivo');
  return tpl
    .replace(/\[\[img\s+([\s\S]*?)\]\]/g, (_, attrs) => picture(attrs, ctx.root))
    .replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, name) => {
      if (!(name in partials)) throw new Error(`partial inexistente: ${name}`);
      return render(partials[name], ctx, depth + 1);
    })
    .replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_, key) => String(get(ctx, key) ?? ''))
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
      const v = get(ctx, key);
      if (v === undefined) throw new Error(`variável indefinida: ${key}`);
      return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    });
}

const pages = walk(join(SRC, 'pages'));
const sitemap = [];
for (const file of pages) {
  const raw = readFileSync(file, 'utf8');
  const m = raw.match(/^<!--meta\s+([\s\S]*?)-->\s*/);
  if (!m) throw new Error(`sem metadados: ${file}`);
  const meta = JSON.parse(m[1]);
  const body = raw.slice(m[0].length);
  const rel = relative(join(SRC, 'pages'), file).split(sep).join('/');
  const depth = rel.split('/').length - 1;
  const basePath = SITE_URL ? new URL(SITE_URL + '/').pathname : '/';
  const root = meta.absolute ? basePath : depth ? '../'.repeat(depth) : './';
  const urlPath = rel === 'index.html' ? '/' : '/' + rel.replace(/index\.html$/, '');
  const nav = Object.fromEntries(['inicio', 'servicos', 'galeria', 'sobre', 'contato', 'agendamento']
    .map((k) => [k, meta.nav === k ? ' aria-current="page"' : '']));
  const scripts = (meta.scripts || []).map((s) =>
    `<script type="module" src="${root}assets/js/${s}.js?v=${VERSION}"></script>`).join('\n');
  const styles = (meta.styles || []).map((s) =>
    `<link rel="stylesheet" href="${root}assets/css/${s}.css?v=${VERSION}">`).join('\n');
  const ctx = {
    ...meta, biz: business, root, v: VERSION, nav, scripts, styles,
    canonical: SITE_URL + urlPath,
    ogImage: SITE_URL + '/images/hero/retrato-azul-1200.webp',
    bodyClass: meta.bodyClass || '',
    robots: meta.noindex ? 'noindex, nofollow' : 'index, follow',
    year: new Date().getFullYear(),
    jsonldTag: meta.jsonld
      ? `<script type="application/ld+json">${JSON.stringify(business.jsonld).replace(/</g, '\\u003c')}</script>` : '',
  };
  let html = render(partials[meta.layout || 'layout'], { ...ctx, content: render(body, ctx) });
  html = html.replace(/\n{3,}/g, '\n\n');
  const outFile = join(OUT, rel);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, html);
  if (!meta.noindex) sitemap.push(urlPath);
}

if (SITE_URL) {
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(join(OUT, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    sitemap.sort().map((p) => `  <url><loc>${SITE_URL}${p}</loc><lastmod>${today}</lastmod></url>`).join('\n') +
    `\n</urlset>\n`);
  writeFileSync(join(OUT, 'robots.txt'),
    `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /meus-agendamentos/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
}
if (!existsSync(join(OUT, 'assets/js/config.js'))) {
  console.warn('Aviso: site/assets/js/config.js não existe. Copie config.example.js e preencha as chaves do Supabase.');
}
console.log(`${pages.length} páginas geradas em site/ (versão ${VERSION})`);
