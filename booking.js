import { db, doc, updateDoc, runTransaction, serverTimestamp } from '../core/firebase.js';
import { state } from '../core/state.js';
import { esc, toast, onAction, requireRole } from '../core/ui.js';
import { addView } from '../core/views.js';
import { ratesText } from '../core/format.js';

const CLEAR = { status: 'Disponible', tenantUid: null, tenantName: null, paymentStatus: null, departureRequested: false, reservedAt: null };
const history = (a) => state.payments.filter(p => p.aptId === a.id).sort((x, y) => (y.createdAt?.seconds || 0) - (x.createdAt?.seconds || 0)).map(p =>
  `<p class="muted-text" style="margin-bottom:6px">💵 ${esc(p.period)} — ${esc(p.amount)} $ — <strong>${esc(p.status)}</strong>${p.status === 'Validé' ? ` <button class="btn-action-trigger outline-btn small-btn" data-action="view-receipt" data-id="${esc(p.id)}">Quittance</button>` : ''}${p.refusalReason ? ` (${esc(p.refusalReason)})` : ''}</p>`).join('');
const aptRef = (id) => doc(db, 'apartments', id);

function renderMyRental(box) {
  const mine = state.apartments.filter(a => a.tenantUid === state.user.uid);
  if (!mine.length) { box.innerHTML = '<div class="blank-slate"><i class="fa-solid fa-house-user"></i><p>Aucun logement réservé ou occupé.</p></div>'; return; }
  box.innerHTML = mine.map(a => {
    let info, btn;
    if (a.status === 'Réservé') { info = '⏳ Réservation en attente de confirmation du bailleur'; btn = `<button class="btn-action-trigger danger-btn" data-action="cancel-booking" data-id="${esc(a.id)}">Annuler la demande</button>`; }
    else if (a.departureRequested) { info = '🚪 Départ signalé — en attente de traitement par le bailleur'; btn = ''; }
    else { info = '✅ Location confirmée'; btn = `<button class="btn-action-trigger tenant-btn" data-action="declare-payment" data-id="${esc(a.id)}">Signaler un paiement</button> ` + `<button class="btn-action-trigger danger-btn" data-action="leave-request" data-id="${esc(a.id)}">Signaler mon départ</button>`; }
    return `<div class="surface-box"><h3>${esc(a.title)}</h3><p class="muted-text">${esc(a.commune)} • ${esc(a.reference)}<br>${esc(ratesText(a))}</p><p class="muted-text">${info}</p>${history(a)}${btn}</div>`;
  }).join('');
}

export default {
  name: 'booking',
  init() {
    addView('tenant', 'my-rental', renderMyRental, ['apartments:changed', 'payments:changed']);

    onAction('book', async (el) => {
      requireRole('tenant');
      if (!confirm('Envoyer une demande de réservation au bailleur ?')) return;
      await runTransaction(db, async (tx) => { // évite que deux locataires réservent le même bien
        const r = aptRef(el.dataset.id), s = await tx.get(r);
        if (!s.exists() || s.data().status !== 'Disponible') throw new Error("Ce logement n'est plus disponible.");
        tx.update(r, { status: 'Réservé', tenantUid: state.user.uid, tenantName: state.user.name, paymentStatus: null, reservedAt: serverTimestamp() });
      });
      toast('Demande envoyée. Le bailleur doit la confirmer.', 'ok');
    });
    onAction('cancel-booking', async (el) => { requireRole('tenant'); if (confirm('Annuler votre demande ?')) await updateDoc(aptRef(el.dataset.id), CLEAR); });
    onAction('leave-request', async (el) => {
      requireRole('tenant');
      if (!confirm('Signaler votre départ au bailleur ?')) return;
      await updateDoc(aptRef(el.dataset.id), { departureRequested: true });
      toast('Départ signalé au bailleur.', 'ok');
    });
    onAction('confirm-booking', async (el) => { requireRole('owner'); await updateDoc(aptRef(el.dataset.id), { status: 'Loué', paymentStatus: 'En attente' }); toast('Location confirmée.', 'ok'); });
    onAction('refuse-booking', async (el) => { requireRole('owner'); if (confirm('Refuser cette demande ?')) await updateDoc(aptRef(el.dataset.id), CLEAR); });
    onAction('process-departure', async (el) => { requireRole('owner'); if (confirm('Libérer le logement ?')) { await updateDoc(aptRef(el.dataset.id), CLEAR); toast('Logement libéré.', 'ok'); } });
  }
};
