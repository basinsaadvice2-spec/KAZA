import { state } from '../core/state.js';
import { bus } from '../core/bus.js';
import { $, esc, onAction } from '../core/ui.js';
import { addView, show } from '../core/views.js';
import { matchesFilters, ratesText, photosOf, safeUrl, telHref, waHref, inquiryMessage } from '../core/format.js';

const FILTER_IDS = ['filter-search', 'filter-commune', 'filter-max-price', 'filter-rate-type', 'filter-snel', 'filter-water'];
const filters = () => ({
  q: $('filter-search').value.trim().toLowerCase(), commune: $('filter-commune').value,
  maxPrice: Number($('filter-max-price').value) || 0, rateType: $('filter-rate-type').value,
  snel: $('filter-snel').value, water: $('filter-water')?.value || '', type: state.selectedTypeTag
});

function card(a) {
  const photos = photosOf(a).map(safeUrl).filter(Boolean);
  const maps = safeUrl(a.mapsUrl);
  const img = photos.length ? `<img class="main-photo" src="${esc(photos[0])}" alt="${esc(a.title)}">` : '<i class="fa-solid fa-image" style="font-size:40px;opacity:.3"></i>';
  const thumbs = photos.length > 1 ? `<div class="gallery-miniatures">${photos.map((p, i) => `<img data-action="thumb" data-src="${esc(p)}" src="${esc(p)}" class="${i ? '' : 'active-thumb'}" alt="Photo ${i + 1}">`).join('')}</div>` : '';
  const contact = a.ownerPhone ? `<div class="tenant-actions-row"><a class="quick-contact-btn call" href="${esc(telHref(a.ownerPhone))}"><i class="fa-solid fa-phone"></i> Appeler</a><a class="quick-contact-btn whatsapp" target="_blank" rel="noopener" href="${esc(waHref(a.ownerPhone, inquiryMessage(a)))}"><i class="fa-brands fa-whatsapp"></i> WhatsApp</a></div>` : '';
  const tags = [a.type, a.snel && `SNEL : ${a.snel}`, a.water && `Eau : ${a.water}`, a.garantie && `Garantie : ${a.garantie}`].filter(Boolean).map(t => `<span class="kin-spec-tag">${esc(t)}</span>`).join('');
  return `<div class="apartment-card-ui">
    <div class="apartment-card-image-placeholder">${img}<span class="apartment-card-badge badge-dispo">Disponible</span></div>${thumbs}
    <div class="apartment-card-details">
      <div class="apartment-card-location">${esc(a.commune)}</div>
      <div class="apartment-card-title">${esc(a.title)}</div>
      <div class="apartment-card-address-detail">${esc(a.reference)}${maps ? ` • <a href="${esc(maps)}" target="_blank" rel="noopener" style="color:var(--primary)">Google Maps</a>` : ''}</div>
      <div class="kin-specs-tags">${tags}</div>
      <div class="apartment-card-pricing-row"><div class="apartment-card-price" style="font-size:16px;">${esc(ratesText(a))}</div></div>
      ${contact}
      <button class="btn-submit-form" style="background:var(--input-bg);color:var(--text-main);border:1px solid var(--border)" data-action="open-chat-apt" data-id="${esc(a.id)}"><i class="fa-solid fa-comment-dots"></i> Écrire au bailleur</button>
      <button class="btn-submit-form tenant-theme" data-action="book" data-id="${esc(a.id)}">Réserver ce logement</button>
    </div></div>`;
}

function render(box) {
  const list = state.apartments.filter(a => matchesFilters(a, filters()));
  box.innerHTML = list.length ? list.map(card).join('') : '<div class="blank-slate"><i class="fa-solid fa-house-circle-xmark"></i><p>Aucun logement ne correspond.</p></div>';
}

export default {
  name: 'catalog',
  init() {
    addView('tenant', 'catalog', render, ['apartments:changed']);
    const refresh = () => show('tenant', 'catalog');
    FILTER_IDS.forEach(id => { const el = $(id); if (el) { el.addEventListener('input', refresh); el.addEventListener('change', refresh); } });
    document.querySelectorAll('.filter-tag').forEach(tag => tag.addEventListener('click', () => {
      document.querySelectorAll('.filter-tag').forEach(t => t.classList.toggle('active', t === tag));
      state.selectedTypeTag = tag.dataset.type; refresh();
    }));
    bus.on('tab:changed', ({ area, tab }) => { if (area === 'tenant') $('tenant-search-box').style.display = tab === 'catalog' ? 'block' : 'none'; });
    bus.on('session:start', (u) => { if (u.role === 'tenant') { $('tenant-greeting').innerText = `Bonjour, ${u.name}`; show('tenant', 'catalog'); } });
    onAction('thumb', (el) => {
      const c = el.closest('.apartment-card-ui');
      c.querySelector('.main-photo').src = el.dataset.src;
      c.querySelectorAll('.gallery-miniatures img').forEach(i => i.classList.toggle('active-thumb', i === el));
    });
  }
};
