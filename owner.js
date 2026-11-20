import { db, storage, doc, deleteDoc, ref, deleteObject } from '../core/firebase.js';
import { state } from '../core/state.js';
import { bus } from '../core/bus.js';
import { $, esc, toast, onAction, requireRole, openModal } from '../core/ui.js';
import { addView, show } from '../core/views.js';
import { ratesOf, ratesText, photosOf, safeUrl } from '../core/format.js';

const thumbs = (a) => {
  const ps = photosOf(a).map(safeUrl).filter(Boolean);
  return ps.length > 1 ? `<div class="gallery-miniatures">${ps.map((p, i) => `<img data-action="thumb" data-src="${esc(p)}" src="${esc(p)}" class="${i ? '' : 'active-thumb'}" alt="Photo ${i + 1}">`).join('')}</div>` : '';
};
const BADGE = { 'Disponible': 'badge-dispo', 'Réservé': 'badge-dispo" style="background:rgba(245,158,11,.95)', 'Loué': 'badge-loue' };

function render(box) {
  const mine = state.apartments.filter(a => a.ownerUid === state.user.uid);
  const rented = mine.filter(a => a.status === 'Loué'), free = mine.filter(a => a.status === 'Disponible');
  const estimated = rented.reduce((s, a) => s + Number(ratesOf(a).month || a.price || 0), 0);
  const month = new Date().toISOString().slice(0, 7);
  const collected = state.payments.filter(p => p.status === 'Validé' && p.period === month).reduce((s, p) => s + Number(p.amount || 0), 0);
  const pending = mine.filter(a => a.status === 'Réservé' || (a.status === 'Loué' && a.departureRequested));

  const pendingHtml = pending.length ? `<div class="surface-box"><h4 style="margin-bottom:12px">À traiter (${pending.length})</h4>${pending.map(a => {
    const isBooking = a.status === 'Réservé';
    return `<div style="border-top:1px solid var(--border);padding:12px 0"><strong>${esc(a.title)}</strong><p class="muted-text" style="margin:4px 0 10px">${isBooking ? '🔑 Demande de réservation de' : '🚪 Départ signalé par'} ${esc(a.tenantName || 'un locataire')}</p>
      ${isBooking ? `<button class="btn-action-trigger tenant-btn small-btn" data-action="confirm-booking" data-id="${esc(a.id)}">Confirmer</button> <button class="btn-action-trigger danger-btn small-btn" data-action="refuse-booking" data-id="${esc(a.id)}">Refuser</button>`
        : `<button class="btn-action-trigger small-btn" data-action="process-departure" data-id="${esc(a.id)}">Traiter le départ</button>`}</div>`;
  }).join('')}</div>` : '';

  const list = mine.length ? mine.map(a => {
    const p = safeUrl(photosOf(a)[0]);
    return `<div class="apartment-card-ui"><div class="apartment-card-image-placeholder">${p ? `<img class="main-photo" src="${esc(p)}" alt="${esc(a.title)}">` : '<i class="fa-solid fa-image" style="font-size:40px;opacity:.3"></i>'}<span class="apartment-card-badge ${BADGE[a.status] || 'badge-loue'}">${esc(a.status)}</span></div>${thumbs(a)}
      <div class="apartment-card-details"><div class="apartment-card-location">${esc(a.commune)}</div><div class="apartment-card-title">${esc(a.title)}</div>
      <div class="apartment-card-pricing-row"><div class="apartment-card-price" style="font-size:15px;">${esc(ratesText(a))}</div>
      ${a.status === 'Disponible' ? `<button class="btn-action-trigger danger-btn small-btn" data-action="delete-apart" data-id="${esc(a.id)}">Supprimer</button>` : ''}</div></div></div>`;
  }).join('') : '<div class="blank-slate"><i class="fa-solid fa-building"></i><p>Aucun bien publié.</p></div>';

  box.innerHTML = `<div class="stats-grid-row">
    <div class="stats-kpi-card blue-indicator"><div class="stats-kpi-header">Total biens</div><div class="stats-kpi-number">${mine.length}</div></div>
    <div class="stats-kpi-card green-indicator"><div class="stats-kpi-header">Occupés</div><div class="stats-kpi-number">${rented.length}</div></div>
    <div class="stats-kpi-card blue-indicator"><div class="stats-kpi-header">Disponibles</div><div class="stats-kpi-number">${free.length}</div></div></div>
    <div class="revenue-box"><div><h4>Revenus estimés / mois</h4></div><strong>${estimated} $</strong></div>
    <div class="revenue-box"><div><h4>Encaissé ce mois</h4></div><strong>${collected} $</strong></div>${pendingHtml}
    <div class="action-context-bar"><span class="context-title">Mes propriétés</span><button class="btn-action-trigger" data-action="open-publish"><i class="fa-solid fa-plus"></i> Ajouter</button></div>${list}`;
}

export default {
  name: 'owner',
  init() {
    addView('owner', 'owner-apparts', render, ['apartments:changed', 'payments:changed']);
    bus.on('session:start', (u) => { if (u.role === 'owner') { $('owner-greeting').innerText = `Bonjour, ${u.name}`; show('owner', 'owner-apparts'); } });
    onAction('open-publish', () => { requireRole('owner'); openModal('add-appart-modal'); });
    onAction('delete-apart', async (el) => {
      requireRole('owner');
      const a = state.apartments.find(x => x.id === el.dataset.id);
      if (!a || a.status !== 'Disponible') throw new Error('Seuls les biens non loués peuvent être supprimés.');
      if (!confirm('Supprimer cette annonce ?')) return;
      await deleteDoc(doc(db, 'apartments', a.id));
      await Promise.allSettled((a.photoPaths || []).map(p => deleteObject(ref(storage, p))));
      toast('Annonce supprimée.', 'ok');
    });
  }
};
