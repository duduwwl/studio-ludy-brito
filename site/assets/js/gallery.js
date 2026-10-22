// Galeria: filtros e visualização ampliada com teclado e gesto de deslizar.
const grid = document.querySelector('[data-gallery]');
const filters = document.querySelector('[data-gallery-filters]');
const count = document.querySelector('[data-gallery-count]');
const box = document.querySelector('[data-lightbox]');
const img = box.querySelector('[data-lightbox-img]');
const caption = box.querySelector('[data-lightbox-caption]');
const counter = box.querySelector('[data-lightbox-count]');
let visible = [];
let index = 0;
let opener = null;

const items = () => [...grid.querySelectorAll('.gallery-item')];

filters.addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  filters.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
  const f = b.dataset.filter;
  let n = 0;
  items().forEach((it) => {
    const show = !f || it.dataset.cat === f;
    it.classList.toggle('is-filtered', !show);
    if (show) { n += 1; it.classList.add('is-in'); }
  });
  count.textContent = `${n} foto${n === 1 ? '' : 's'}`;
});

function show(i) {
  index = (i + visible.length) % visible.length;
  const it = visible[index];
  const btn = it.querySelector('button');
  img.src = btn.dataset.full;
  img.alt = it.querySelector('img').alt;
  caption.textContent = it.querySelector('figcaption')?.textContent || '';
  counter.textContent = `${index + 1} de ${visible.length}`;
}

grid.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-full]');
  if (!btn) return;
  visible = items().filter((it) => !it.classList.contains('is-filtered'));
  opener = btn;
  show(visible.indexOf(btn.closest('.gallery-item')));
  box.showModal();
  document.body.style.overflow = 'hidden';
});

const close = () => box.close();
box.addEventListener('close', () => { document.body.style.overflow = ''; opener?.focus(); });
box.querySelector('[data-lightbox-close]').addEventListener('click', close);
box.querySelector('[data-lightbox-prev]').addEventListener('click', () => show(index - 1));
box.querySelector('[data-lightbox-next]').addEventListener('click', () => show(index + 1));
box.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') show(index + 1);
  if (e.key === 'ArrowLeft') show(index - 1);
});
box.addEventListener('click', (e) => { if (e.target.classList.contains('lightbox-stage')) close(); });
let x0 = null;
box.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
box.addEventListener('touchend', (e) => {
  if (x0 == null) return;
  const dx = e.changedTouches[0].clientX - x0;
  if (Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1));
  x0 = null;
});
