import { db, collection, doc, updateDoc, runTransaction, serverTimestamp, writeBatch } from './firebase.js';
import { state } from './state.js';
import { $, esc, toast, onAction, requireRole, openModal, closeModal } from './ui.js';
import { addView } from './views.js';
import { ratesText, availabilityStatusOf } from './format.js';

const CLEAR = { status: 'publie', availabilityStatus: 'Disponible', tenantUid: null, tenantName: null, paymentStatus: null, departureRequested: false, reservedAt: null, departureReviewId: null };
const history = (a) => state.payments.filter(p => p.aptId === a.id).sort((x, y) => (y.createdAt?.seconds || 0) - (x.createdAt?.seconds || 0)).map(p =>
  `<p class="muted-text" style="margin-bottom:6px">💵 ${esc(p.period)} — ${esc(p.amount)} $ — <strong>${esc(p.status)}</strong>${p.status === 'Validé' ? ` <button class="btn-action-trigger outline-btn small-btn" data-action="view-receipt" data-id="${esc(p.id)}">Quittance</button>` : ''}${p.refusalReason ? ` (${esc(p.refusalReason)})` : ''}</p>`).join('');
const aptRef = (id) => doc(db, 'apartments', id);

function clearDepartureReviewErrors() {
  ['review-payment-speed', 'review-property-care'].forEach((id) => {
    const error = $(`${id}-error`);
    error.hidden = true;
    error.textContent = '';
    $(id).removeAttribute('aria-invalid');
  });
  $('departure-review-feedback').hidden = true;
  $('departure-review-feedback').textContent = '';
}

function openDepartureReview(apartment) {
  requireRole('owner');
  if (!apartment || availabilityStatusOf(apartment) !== 'Loué' || !apartment.departureRequested || !apartment.tenantUid) {
    throw new Error('Ce départ ne peut plus être traité. Actualisez la liste des biens.');
  }
  clearDepartureReviewErrors();
  $('review-payment-speed').value = '';
  $('review-property-care').value = '';
  $('departure-review-property').textContent = `Logement : ${apartment.title || 'Sans titre'} — Locataire : ${apartment.tenantName || 'Locataire'}`;
  $('departure-review-modal').dataset.apartmentId = apartment.id;
  const submit = $('btn-submit-departure-review');
  submit.disabled = false;
  submit.textContent = 'Enregistrer les notes et libérer le logement';
  openModal('departure-review-modal');
  $('review-payment-speed').focus();
}

function setReviewFieldError(id, message) {
  const field = $(id);
  const error = $(`${id}-error`);
  field.setAttribute('aria-invalid', 'true');
  error.textContent = message;
  error.hidden = false;
}

function renderMyRental(box) {
  const mine = state.apartments.filter(a => a.tenantUid === state.user.uid);
  if (!mine.length) { box.innerHTML = '<div class="blank-slate"><i class="fa-solid fa-house-user"></i><p>Aucun logement réservé ou occupé.</p></div>'; return; }
  box.innerHTML = mine.map(a => {
    let info, btn;
    if (availabilityStatusOf(a) === 'Réservé') { info = '⏳ Réservation en attente de confirmation du bailleur'; btn = `<button class="btn-action-trigger danger-btn" data-action="cancel-booking" data-id="${esc(a.id)}">Annuler la demande</button>`; }
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
      if (!confirm('Envoyer une demande de réservation au bailleur ?\n\nAucun montant ne sera versé à cette étape. Le bailleur devra confirmer la demande.')) return;
      try {
        await runTransaction(db, async (tx) => { // évite que deux locataires réservent le même bien
          const r = aptRef(el.dataset.id), s = await tx.get(r);
          if (!s.exists() || availabilityStatusOf(s.data()) !== 'Disponible') throw new Error("Ce logement n'est plus disponible.");
          const update = {
            status: 'publie',
            availabilityStatus: 'Réservé',
            tenantUid: state.user.uid,
            tenantName: state.user.name,
            paymentStatus: null,
            reservedAt: serverTimestamp()
          };
          // Ne transmet ce champ que s'il existe; ainsi les règles plus anciennes restent compatibles.
          if (s.data().departureReviewId) update.departureReviewId = null;
          tx.update(r, update);
        });
      } catch (error) {
        console.error('[KAZA] Demande de réservation refusée', error);
        if (error?.code?.includes('permission-denied')) {
          throw new Error('Firestore refuse cette réservation. Vérifiez que votre profil a le rôle « tenant » et que les règles Firestore à jour sont publiées.');
        }
        if (!navigator.onLine || ['unavailable', 'deadline-exceeded', 'network-request-failed'].some((part) => error?.code?.includes(part))) {
          throw new Error('Connexion indisponible. Vérifiez Internet puis réessayez.');
        }
        throw new Error(error.message || 'La demande de réservation n’a pas été enregistrée. Réessayez.');
      }
      toast('Demande envoyée. Le bailleur doit la confirmer.', 'ok');
    });
    onAction('cancel-booking', async (el) => { requireRole('tenant'); if (confirm('Annuler votre demande ?')) await updateDoc(aptRef(el.dataset.id), CLEAR); });
    onAction('leave-request', async (el) => {
      requireRole('tenant');
      if (!confirm('Signaler votre départ au bailleur ?')) return;
      await updateDoc(aptRef(el.dataset.id), { departureRequested: true });
      toast('Départ signalé au bailleur.', 'ok');
    });
    onAction('confirm-booking', async (el) => { requireRole('owner'); await updateDoc(aptRef(el.dataset.id), { status: 'publie', availabilityStatus: 'Loué', paymentStatus: 'En attente' }); toast('Location confirmée.', 'ok'); });
    onAction('refuse-booking', async (el) => { requireRole('owner'); if (confirm('Refuser cette demande ?')) await updateDoc(aptRef(el.dataset.id), CLEAR); });
    onAction('process-departure', (el) => {
      requireRole('owner');
      openDepartureReview(state.apartments.find((apartment) => apartment.id === el.dataset.id));
    });
    onAction('cancel-departure-review', () => closeModal('departure-review-modal'));
    onAction('submit-departure-review', async (button) => {
      requireRole('owner');
      clearDepartureReviewErrors();
      const paymentSpeed = Number($('review-payment-speed').value);
      const propertyCare = Number($('review-property-care').value);
      let invalid = false;
      if (!Number.isInteger(paymentSpeed) || paymentSpeed < 1 || paymentSpeed > 5) {
        setReviewFieldError('review-payment-speed', 'Choisissez une note de 1 à 5.');
        invalid = true;
      }
      if (!Number.isInteger(propertyCare) || propertyCare < 1 || propertyCare > 5) {
        setReviewFieldError('review-property-care', 'Choisissez une note de 1 à 5.');
        invalid = true;
      }
      if (invalid) {
        const firstInvalid = document.querySelector('#departure-review-modal [aria-invalid="true"]');
        firstInvalid?.focus();
        firstInvalid?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }

      const apartmentId = $('departure-review-modal').dataset.apartmentId;
      const apartment = state.apartments.find((item) => item.id === apartmentId);
      if (!apartment || !apartment.tenantUid || availabilityStatusOf(apartment) !== 'Loué' || !apartment.departureRequested) {
        throw new Error('Ce départ ne peut plus être traité. Actualisez la liste des biens.');
      }

      const idleLabel = 'Enregistrer les notes et libérer le logement';
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Enregistrement...';
      try {
        const reviewRef = doc(collection(db, 'tenantReferences', apartment.tenantUid, 'reviews'));
        const batch = writeBatch(db);
        batch.set(reviewRef, {
          tenantUid: apartment.tenantUid,
          reviewerUid: state.user.uid,
          apartmentId: apartment.id,
          apartmentTitle: apartment.title || '',
          paymentSpeed,
          propertyCare,
          createdAt: serverTimestamp()
        });
        batch.update(aptRef(apartment.id), { ...CLEAR, departureReviewId: reviewRef.id });
        await batch.commit();
        closeModal('departure-review-modal');
        clearDepartureReviewErrors();
        toast('Évaluation enregistrée et logement libéré.', 'ok');
      } catch (error) {
        console.error('[KAZA] Évaluation du locataire impossible', error);
        const message = error?.code?.includes('permission-denied')
          ? 'Firestore a refusé l’évaluation. Vérifiez que les dernières règles Firestore sont publiées.'
          : !navigator.onLine
            ? 'Connexion interrompue. Vérifiez Internet puis réessayez.'
            : 'Impossible d’enregistrer l’évaluation. Réessayez dans un instant.';
        toast(message, 'error');
      } finally {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.textContent = idleLabel;
      }
    });
    ['review-payment-speed', 'review-property-care'].forEach((id) => {
      $(id).addEventListener('change', () => {
        const error = $(`${id}-error`);
        error.hidden = true;
        error.textContent = '';
        $(id).removeAttribute('aria-invalid');
      });
    });
  }
};
