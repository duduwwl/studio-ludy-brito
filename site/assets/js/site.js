// Comportamentos comuns a todas as páginas públicas.
import { rpc, isConfigured, isDemo } from './api.js';

// Aviso visível quando a página roda em modo demonstração (sem banco real).
if (isDemo()) {
  const note = document.createElement('p');
  note.className = 'demo-note';
  note.textContent = 'Demonstração: a agenda funciona neste navegador, mas nenhum horário é reservado de verdade.';
  document.body.prepend(note);
}

// Menu do celular
const toggle = document.querySelector('[data-menu-toggle]');
const menu = document.querySelector('[data-menu]');
if (toggle && menu) {
  const label = toggle.querySelector('.bar-menu-label');
  const setOpen = (open) => {
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('menu-open', open);
    if (label) label.textContent = open ? 'Fechar' : 'Menu';
    if (open) menu.querySelector('a')?.focus();
  };
  toggle.addEventListener('click', () => setOpen(menu.hidden));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { setOpen(false); toggle.focus(); } });
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
  matchMedia('(min-width: 64em)').addEventListener('change', (e) => { if (e.matches) setOpen(false); });
}

// Entrada das seções: uma vez, sem nunca deixar conteúdo escondido.
export function observeReveals(root = document) {
  const targets = root.querySelectorAll('[data-reveal]:not(.is-in)');
  if (!targets.length) return;
  if (!('IntersectionObserver' in window)) { targets.forEach((el) => el.classList.add('is-in')); return; }
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-in');
      io.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.08 });
  targets.forEach((el, i) => {
    if (!el.style.getPropertyValue('--i')) {
      const siblings = [...el.parentElement.children].filter((c) => c.hasAttribute('data-reveal'));
      el.style.setProperty('--i', String(Math.max(0, siblings.indexOf(el))));
    }
    io.observe(el);
    void i;
  });
  setTimeout(() => {
    targets.forEach((el) => { const r = el.getBoundingClientRect(); if (r.top < innerHeight && r.bottom > 0) el.classList.add('is-in'); });
  }, 2500);
}
observeReveals();

// Dados públicos do site com cache curto na sessão.
let sitePromise = null;
export function getPublicSite() {
  if (!isConfigured()) return Promise.reject(new Error('NOT_CONFIGURED'));
  if (sitePromise) return sitePromise;
  try {
    const cached = JSON.parse(sessionStorage.getItem('lb.site') || 'null');
    if (cached && Date.now() - cached.t < 2 * 60 * 1000) return (sitePromise = Promise.resolve(cached.data));
  } catch { /* sem cache */ }
  sitePromise = rpc('get_public_site').then((data) => {
    try { sessionStorage.setItem('lb.site', JSON.stringify({ t: Date.now(), data })); } catch { /* ignora */ }
    return data;
  }).catch((e) => { sitePromise = null; throw e; });
  return sitePromise;
}
