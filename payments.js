import { db, collection, doc, addDoc, query, where, onSnapshot, writeBatch, serverTimestamp } from './firebase.js';
import { state } from './state.js';
import { bus } from './bus.js';
import { $, esc, toast, onAction, bindActions, openModal, closeModal, requireRole } from './ui.js';
import { addView } from './views.js';
import { notify } from './notify.js';
import { ratesOf, receiptNo, fmtDate } from './format.js';
let unsub = null;
const PRINT_CSS = '<style>@media print{body>*:not(#receipt-modal){display:none!important}#receipt-modal{position:static!important;background:none!important;backdrop-filter:none!important;display:block!important}#receipt-modal .modal-box{box-shadow:none;max-height:none;background:#fff;color:#000}#receipt-modal .modal-actions{display:none}}</style>';
const MODAL = `<div id="payment-modal" class="modal-overlay" style="display:none"><div class="modal-box"><h3>Signaler un paiement</h3>
<div class="form-input-container no-icon"><label>Montant ($)</label><input type="number" id="pay-amount"></div>
<div class="form-input-container no-icon"><label>Période</label><input type="month" id="pay-period"></div>
<div class="form-input-container no-icon"><label>Mode de paiement</label><select id="pay-method"><option>Mobile Money</option><option>Espèces</option><option>Banque</option></select></div>
<div class="form-input-container no-icon"><label>Référence de transaction (facultatif)</label><input type="text" id="pay-ref"></div>
<div class="modal-actions"><button class="btn-submit-form" style="background:var(--text-muted)" data-action="pay-cancel">Annuler</button><button class="btn-submit-form tenant-theme" data-action="pay-submit">Envoyer</button></div></div></div>`;

function renderOwner(box) {
  const mine = state.payments.filter(p => p.ownerUid === state.user.uid).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  const row = (p) => `<div style="border-top:1px solid var(--border);padding:12px 0"><strong>${esc(p.aptTitle)}</strong><p class="muted-text" style="margin:4px 0 8px">${esc(p.tenantName)} • ${esc(p.period)} • ${esc(p.amount)} $ • ${esc(p.method)}${p.reference ? ' • ' + esc(p.reference) : ''}</p>
    ${p.status === 'En attente' ? `<button class="btn-action-trigger tenant-btn small-btn" data-action="pay-validate" data-id="${esc(p.id)}">Valider</button> <button class="btn-action-trigger danger-btn small-btn" data-action="pay-refuse" data-id="${esc(p.id)}">Refuser</button>`
      : `<span class="muted-text">${esc(p.status)}</span> ${p.status === 'Validé' ? `<button class="btn-action-trigger outline-btn small-btn" data-action="view-receipt" data-id="${esc(p.id)}">Quittance</button>` : ''}`}</div>`;
  const wait = mine.filter(p => p.status === 'En attente'), done = mine.filter(p => p.status !== 'En attente');
  box.innerHTML = `<div class="surface-box"><h4>Paiements à valider (${wait.length})</h4>${wait.map(row).join('') || '<p class="muted-text">Aucun paiement en attente.</p>'}</div>
    <div class="surface-box"><h4>Historique</h4>${done.map(row).join('') || '<p class="muted-text">Aucun historique.</p>'}</div>`;
}

export default {
  name: 'payments',
  init() {
    document.head.insertAdjacentHTML('beforeend', PRINT_CSS);
    document.body.insertAdjacentHTML('beforeend', MODAL);
    const nav = document.querySelector('#scr-owner-dashboard .bottom-navigation-bar');
    nav.querySelector('[data-tab="owner-apparts"]').insertAdjacentHTML('afterend', '<div class="tab-navigation-item" data-tab="owner-payments"><i class="fa-solid fa-money-bill-wave"></i><span>Paiements</span></div>');
    nav.style.gridTemplateColumns = 'repeat(4, 1fr)';
    bindActions({ '#btn-close-receipt': 'close-receipt' });
    addView('owner', 'owner-payments', renderOwner, ['payments:changed']);

    bus.on('session:start', (u) => {
      unsub?.();
      unsub = onSnapshot(query(collection(db, 'payments'), where(u.role === 'owner' ? 'ownerUid' : 'tenantUid', '==', u.uid)), (s) => {
        state.payments = s.docs.map(d => ({ id: d.id, ...d.data() })); bus.emit('payments:changed');
      }, (e) => toast('Lecture des paiements refusée (' + e.code + ').', 'error'));
    });
    bus.on('session:end', () => { unsub?.(); unsub = null; state.payments = []; });

    onAction('declare-payment', (el) => {
      requireRole('tenant');
      const a = state.apartments.find(x => x.id === el.dataset.id); if (!a) throw new Error('Logement introuvable.');
      $('payment-modal').dataset.aptId = a.id;
      $('pay-amount').value = ratesOf(a).month || a.price || '';
      $('pay-period').value = new Date().toISOString().slice(0, 7);
      $('pay-ref').value = ''; openModal('payment-modal');
    });
    onAction('pay-cancel', () => closeModal('payment-modal'));
    onAction('pay-submit', async () => {
      requireRole('tenant');
      const a = state.apartments.find(x => x.id === $('payment-modal').dataset.aptId), amount = Number($('pay-amount').value), period = $('pay-period').value;
      if (!a || !(amount > 0) || !period) throw new Error('Renseignez le montant et la période.');
      await addDoc(collection(db, 'payments'), { aptId: a.id, aptTitle: a.title, ownerUid: a.ownerUid, tenantUid: state.user.uid, tenantName: state.user.name, amount, period, method: $('pay-method').value, reference: $('pay-ref').value.trim(), status: 'En attente', createdAt: serverTimestamp() });
      await notify(a.ownerUid, 'payment', 'Paiement déclaré', `${state.user.name} déclare ${amount} $ pour ${period} (${a.title}).`, { tab: 'owner-payments' });
      closeModal('payment-modal'); toast('Paiement signalé au bailleur.', 'ok');
    });
    onAction('pay-validate', async (el) => {
      requireRole('owner');
      const p = state.payments.find(x => x.id === el.dataset.id); if (!p) return;
      const b = writeBatch(db);
      b.update(doc(db, 'payments', p.id), { status: 'Validé', decidedAt: serverTimestamp(), receiptNo: receiptNo(p) });
      b.update(doc(db, 'apartments', p.aptId), { paymentStatus: 'À jour' });
      await b.commit();
      await notify(p.tenantUid, 'payment', 'Paiement validé', `Votre paiement de ${p.period} est validé. Quittance disponible.`, { tab: 'my-rental' });
      toast('Paiement validé. Quittance générée.', 'ok');
    });
    onAction('pay-refuse', async (el) => {
      requireRole('owner');
      const p = state.payments.find(x => x.id === el.dataset.id); if (!p) return;
      const reason = prompt('Motif du refus (facultatif) :'); if (reason === null) return;
      const b = writeBatch(db);
      b.update(doc(db, 'payments', p.id), { status: 'Refusé', decidedAt: serverTimestamp(), refusalReason: reason.trim() });
      await b.commit();
      await notify(p.tenantUid, 'payment', 'Paiement refusé', `Votre paiement de ${p.period} a été refusé.${reason ? ' Motif : ' + reason : ''}`, { tab: 'my-rental' });
    });
    onAction('view-receipt', (el) => {
      const p = state.payments.find(x => x.id === el.dataset.id); if (!p || p.status !== 'Validé') throw new Error('Quittance indisponible.');
      const a = state.apartments.find(x => x.id === p.aptId) || {};
      $('receipt-body').innerHTML = `<p style="text-align:center"><strong style="font-size:18px">KAZA</strong><br>Quittance N° <strong>${esc(p.receiptNo || receiptNo(p))}</strong></p><hr>
        <p><b>Bailleur :</b> ${esc(a.ownerName || '')} ${esc(a.ownerPhone || '')}</p><p><b>Locataire :</b> ${esc(p.tenantName)}</p>
        <p><b>Bien :</b> ${esc(p.aptTitle)} — ${esc(a.commune || '')} ${esc(a.reference || '')}</p><p><b>Période :</b> ${esc(p.period)}</p>
        <p><b>Montant :</b> ${esc(p.amount)} $</p><p><b>Mode :</b> ${esc(p.method)} ${esc(p.reference || '')}</p><p><b>Validé le :</b> ${esc(fmtDate(p.decidedAt))}</p><hr>
        <p style="font-size:11px">Reçu numérique généré par Kaza après validation du bailleur.</p>`;
      openModal('receipt-modal');
    });
    onAction('close-receipt', () => closeModal('receipt-modal'));
  }
};
