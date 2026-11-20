import { state } from './state.js';
import { bus } from './bus.js';
import { $ } from './ui.js';
const AREA = { owner: { screen: 'scr-owner-dashboard', box: 'owner-dynamic-area' }, tenant: { screen: 'scr-tenant-dashboard', box: 'tenant-dynamic-area' } };
const views = {};
export const current = (area) => document.querySelector(`#${AREA[area].screen} .tab-navigation-item.active`)?.dataset.tab;

export function show(area, tab) {
  document.querySelectorAll(`#${AREA[area].screen} .tab-navigation-item`).forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  bus.emit('tab:changed', { area, tab });
  const box = $(AREA[area].box), render = views[`${area}:${tab}`];
  try {
    if (render) render(box);
    else box.innerHTML = '<div class="blank-slate"><i class="fa-solid fa-hammer"></i><p>Cette section arrive dans le prochain lot.</p></div>';
  } catch (e) { console.error(e); box.innerHTML = '<div class="blank-slate"><p>Erreur d\'affichage de cette section.</p></div>'; }
}
export function addView(area, tab, render, watch = []) {
  views[`${area}:${tab}`] = render;
  watch.forEach(ev => bus.on(ev, () => { if (state.user?.role === area && current(area) === tab) show(area, tab); }));
}
export function initNav() {
  document.addEventListener('click', (e) => {
    const t = e.target.closest('.tab-navigation-item[data-tab]');
    if (!t) return;
    const area = t.closest('#scr-owner-dashboard') ? 'owner' : t.closest('#scr-tenant-dashboard') ? 'tenant' : null;
    if (area) show(area, t.dataset.tab);
  });
}
