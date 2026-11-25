import { db, collection, doc, setDoc, updateDoc, serverTimestamp } from './firebase.js';
import { state } from './state.js';
import { bus } from './bus.js';
import { availabilityStatusOf } from './format.js';
import { $, esc, toast, onAction, bindActions, closeModal, openModal, requireRole } from './ui.js';

const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PHOTO_BYTES = 150 * 1024;
const MAX_PHOTO_DATA_CHARS = 205000;
const MAX_APARTMENT_DOCUMENT_BYTES = 900 * 1024;
const MAX_PHOTOS = 4;
const JPEG_QUALITIES = [0.72, 0.64, 0.56, 0.48, 0.4, 0.34];
const FIELDS = [
  'new-title', 'new-type', 'new-commune', 'new-ref', 'new-landmark', 'new-property-number',
  'new-unit-number', 'new-building-name', 'price-hour', 'price-day', 'price-week', 'price-month',
  'new-garantie', 'new-snel', 'new-water', 'new-maps'
];
let previewUrls = [];

function revokePreviews() {
  previewUrls.forEach((url) => URL.revokeObjectURL(url));
  previewUrls = [];
}

async function decodePhoto(file) {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close?.() };
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error(`La photo « ${file.name} » ne peut pas être lue.`));
      element.src = objectUrl;
    });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => {} };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function blobDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('La photo compressée ne peut pas être lue.'));
    reader.readAsDataURL(blob);
  });
}

async function compressPhoto(file, maxBytes = MAX_PHOTO_BYTES) {
  if (!OK_TYPES.includes(file.type)) throw new Error(`Format refusé pour « ${file.name} ». Choisissez JPG, PNG ou WebP.`);
  let decoded;
  try {
    decoded = await decodePhoto(file);
    const longestSide = Math.max(decoded.width, decoded.height);
    if (!longestSide) throw new Error(`La photo « ${file.name} » ne peut pas être lue.`);
    const edgeSizes = [Math.min(800, longestSide)];
    while (edgeSizes.at(-1) > 320) edgeSizes.push(Math.max(320, Math.floor(edgeSizes.at(-1) * 0.85)));
    const qualities = JPEG_QUALITIES;

    for (const edge of edgeSizes) {
      const scale = Math.min(1, edge / longestSide);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(decoded.width * scale));
      canvas.height = Math.max(1, Math.round(decoded.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Le navigateur ne peut pas compresser les photos. Essayez un navigateur à jour.');

      for (const type of ['image/webp', 'image/jpeg']) {
        context.clearRect(0, 0, canvas.width, canvas.height);
        if (type === 'image/jpeg') {
          context.fillStyle = '#fff';
          context.fillRect(0, 0, canvas.width, canvas.height);
        }
        context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
        for (const quality of qualities) {
          const blob = await canvasBlob(canvas, type, quality);
          if (blob?.type === type && blob.size <= maxBytes) {
            const dataUrl = await blobDataUrl(blob);
            if (dataUrl.length <= MAX_PHOTO_DATA_CHARS) return dataUrl;
          }
        }
      }
    }
    throw new Error(`La photo « ${file.name} » reste trop lourde après compression. Choisissez une autre image.`);
  } catch (error) {
    if (error instanceof Error && /^(La photo|Le navigateur)/.test(error.message)) throw error;
    throw new Error(`La photo « ${file.name} » n’a pas pu être compressée.`);
  } finally {
    decoded?.close();
  }
}

async function dataUrlFile(dataUrl, index) {
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error(`La photo ${index + 1} ne peut pas être relue.`);
  const blob = await response.blob();
  const extension = blob.type === 'image/jpeg' ? 'jpg' : 'webp';
  return new File([blob], `photo-${index + 1}.${extension}`, { type: blob.type });
}

function estimateDocumentBytes(payload) {
  const plain = { ...payload, updatedAt: null };
  if (Object.hasOwn(plain, 'createdAt')) plain.createdAt = null;
  return new TextEncoder().encode(JSON.stringify(plain)).byteLength + 2048;
}

async function fitPhotosToDocument(photos, makePayload) {
  let fittedPhotos = [...photos];
  if (fittedPhotos.some((photo) => typeof photo !== 'string')) throw new Error('Une photo de cette annonce est invalide. Retirez-la puis ajoutez-la à nouveau.');
  let payload = makePayload(fittedPhotos);
  if (estimateDocumentBytes(payload) <= MAX_APARTMENT_DOCUMENT_BYTES) return { photos: fittedPhotos, payload };

  for (const targetBytes of [120, 100, 80, 60].map((kilobytes) => kilobytes * 1024)) {
    fittedPhotos = await Promise.all(fittedPhotos.map(async (photo, index) => {
      if (!photo.startsWith('data:image/')) return photo;
      const file = await dataUrlFile(photo, index);
      return compressPhoto(file, targetBytes);
    }));
    payload = makePayload(fittedPhotos);
    if (estimateDocumentBytes(payload) <= MAX_APARTMENT_DOCUMENT_BYTES) return { photos: fittedPhotos, payload };
  }
  throw new Error('Les photos et les informations dépassent la limite de 900 Ko. Retirez une photo ou choisissez des images plus légères.');
}

const FIELD_ERRORS = {
  'new-title': 'publish-title-error',
  'new-type': 'publish-type-error',
  'new-commune': 'publish-commune-error',
  'new-ref': 'publish-avenue-error',
  rates: 'publish-rates-error',
  photos: 'publish-photos-error'
};

function clearFieldError(field) {
  const error = $(FIELD_ERRORS[field]);
  if (error) { error.hidden = true; error.textContent = ''; }
  if (field !== 'rates' && field !== 'photos') $(field)?.removeAttribute('aria-invalid');
}

function clearFieldErrors() {
  Object.keys(FIELD_ERRORS).forEach(clearFieldError);
  ['price-hour', 'price-day', 'price-week', 'price-month'].forEach((id) => $(id)?.removeAttribute('aria-invalid'));
}

function setFieldError(field, message) {
  const error = $(FIELD_ERRORS[field]);
  if (error) { error.textContent = message; error.hidden = false; }
  if (FIELD_ERRORS[field] && !['rates', 'photos'].includes(field)) $(field)?.setAttribute('aria-invalid', 'true');
  if (field === 'rates') ['price-hour', 'price-day', 'price-week', 'price-month'].forEach((id) => $(id)?.setAttribute('aria-invalid', 'true'));
}

function setPublishFeedback(message = '', type = 'error') {
  const feedback = $('publish-feedback');
  feedback.textContent = message;
  feedback.dataset.state = type;
  feedback.hidden = !message;
}

function updatePropertyFields() {
  const type = $('new-type').value;
  const isUnit = type === 'Appartement' || type === 'Studio';
  $('property-number-wrap').style.display = isUnit ? 'none' : 'block';
  $('property-number-label').textContent = type === 'Parcelle' ? 'Numéro de parcelle' : 'Numéro de maison';
  $('unit-number-wrap').style.display = isUnit ? 'block' : 'none';
  $('building-name-wrap').style.display = isUnit ? 'block' : 'none';
}

function previews() {
  revokePreviews();
  const existing = state.selectedExistingPhotos.map((photo, index) =>
    `<div class="preview-item"><img src="${esc(photo.url)}" alt="Photo existante ${index + 1}"><button type="button" class="btn-remove-photo" data-action="remove-existing-photo" data-idx="${index}" aria-label="Retirer la photo ${index + 1}"><i class="fa-solid fa-xmark"></i></button></div>`
  ).join('');
  const added = state.selectedFiles.map((file, index) => {
    const url = URL.createObjectURL(file);
    previewUrls.push(url);
    return `<div class="preview-item"><img src="${url}" alt="Nouvelle photo ${index + 1}"><button type="button" class="btn-remove-photo" data-action="remove-photo" data-idx="${index}" aria-label="Retirer la nouvelle photo ${index + 1}"><i class="fa-solid fa-xmark"></i></button></div>`;
  }).join('');
  $('photo-counter').innerText = state.selectedExistingPhotos.length + state.selectedFiles.length;
  $('photo-preview-container').innerHTML = existing + added;
}

function emptyForm() {
  FIELDS.forEach((id) => { $(id).value = ''; });
  $('new-type').value = 'Appartement';
  $('new-commune').value = 'Gombe';
  $('new-snel').value = 'Cash Power';
  $('new-water').value = 'Regideso';
  state.selectedFiles = [];
  state.selectedExistingPhotos = [];
  state.editingApartmentId = null;
  clearFieldErrors();
  setPublishFeedback();
  $('publish-modal-title').innerText = 'Publier un nouveau bien';
  $('btn-save-appart').innerText = 'Publier';
  updatePropertyFields();
  previews();
}

function setEditForm(apartment) {
  requireRole('owner');
  if (!apartment || apartment.ownerUid !== state.user.uid) throw new Error('Cette annonce ne vous appartient pas.');
  const rates = apartment.rates || { month: apartment.price || 0 };
  $('new-title').value = apartment.title || '';
  $('new-type').value = apartment.type || 'Appartement';
  $('new-commune').value = apartment.commune || 'Gombe';
  $('new-ref').value = apartment.avenue || apartment.reference || '';
  $('new-landmark').value = apartment.landmark || '';
  $('new-property-number').value = apartment.propertyNumber || '';
  $('new-unit-number').value = apartment.unitNumber || '';
  $('new-building-name').value = apartment.buildingName || '';
  $('price-hour').value = rates.hour || '';
  $('price-day').value = rates.day || '';
  $('price-week').value = rates.week || '';
  $('price-month').value = rates.month || '';
  $('new-garantie').value = apartment.garantie || '';
  $('new-snel').value = apartment.snel || 'Cash Power';
  $('new-water').value = apartment.water || 'Regideso';
  $('new-maps').value = apartment.mapsUrl || '';
  state.selectedFiles = [];
  state.selectedExistingPhotos = (apartment.photos || (apartment.photoUrl ? [apartment.photoUrl] : [])).map((url) => ({ url }));
  state.editingApartmentId = apartment.id;
  clearFieldErrors();
  setPublishFeedback();
  $('publish-modal-title').innerText = 'Modifier cette annonce';
  $('btn-save-appart').innerText = 'Enregistrer les modifications';
  updatePropertyFields();
  previews();
  openModal('add-appart-modal');
}

function selectedPhotos() {
  const type = $('new-type').value;
  const isUnit = type === 'Appartement' || type === 'Studio';
  return {
    propertyNumber: isUnit ? '' : $('new-property-number').value.trim(),
    unitNumber: isUnit ? $('new-unit-number').value.trim() : '',
    buildingName: isUnit ? $('new-building-name').value.trim() : ''
  };
}

function friendlyPublishError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  if (!navigator.onLine || ['unavailable', 'deadline-exceeded', 'network-request-failed'].some((part) => code.includes(part))) {
    return new Error('Connexion interrompue. Vérifiez Internet puis réessayez.');
  }
  if (code.includes('permission-denied')) {
    return new Error('Publication refusée par Firestore. Vérifiez que le profil est bien Bailleur et que les règles Firestore publiées sont à jour.');
  }
  if (/document.*too large|too large|size.{0,24}limit|limit.{0,24}size|ko|mb|byte/.test(message)) {
    return new Error('Le bien dépasse la limite de taille Firestore. Retirez une photo ou choisissez des images plus légères.');
  }
  if (code.includes('resource-exhausted')) return new Error('Une limite d’utilisation Firestore a été atteinte. Réessayez plus tard.');
  if (code.includes('invalid-argument')) return new Error('Les informations du bien sont invalides. Vérifiez les champs et les photos.');
  if (code.startsWith('firestore/')) return new Error(`Firestore n’a pas pu enregistrer l’annonce (${code.split('/').pop()}). Réessayez.`);
  return new Error(error?.message || 'Publication impossible. Réessayez dans un instant.');
}

export default {
  name: 'publish',
  init() {
    bindActions({
      '#btn-save-appart': 'publish-save',
      '#btn-cancel-add': 'publish-cancel',
      '#photo-drop-zone': 'pick-photos'
    });
    $('new-type').addEventListener('change', updatePropertyFields);
    const input = $('new-photo');
    ['new-title', 'new-type', 'new-commune', 'new-ref'].forEach((id) => {
      const field = $(id);
      ['input', 'change'].forEach((eventName) => field.addEventListener(eventName, () => clearFieldError(id)));
    });
    ['price-hour', 'price-day', 'price-week', 'price-month'].forEach((id) => {
      $(id).addEventListener('input', () => clearFieldError('rates'));
    });
    onAction('open-publish', () => { requireRole('owner'); emptyForm(); openModal('add-appart-modal'); });
    onAction('edit-apart', (el) => {
      const apartment = state.apartments.find((item) => item.id === el.dataset.id);
      setEditForm(apartment);
    });
    onAction('pick-photos', (el, event) => { if (event.target !== input) input.click(); });
    input.addEventListener('change', () => {
      for (const file of Array.from(input.files || [])) {
        if (state.selectedExistingPhotos.length + state.selectedFiles.length >= MAX_PHOTOS) { toast('Maximum 4 photos.', 'error'); break; }
        if (!OK_TYPES.includes(file.type)) { toast(`${file.name} : format refusé (JPG, PNG ou WEBP).`, 'error'); continue; }
        if (file.size > 5 * 1024 * 1024) { toast(`${file.name} : plus de 5 Mo.`, 'error'); continue; }
        state.selectedFiles.push(file);
      }
      input.value = '';
      if (state.selectedExistingPhotos.length + state.selectedFiles.length) clearFieldError('photos');
      previews();
    });
    onAction('remove-photo', (el) => { state.selectedFiles.splice(Number(el.dataset.idx), 1); previews(); });
    onAction('remove-existing-photo', (el) => { state.selectedExistingPhotos.splice(Number(el.dataset.idx), 1); previews(); });
    onAction('publish-cancel', () => { closeModal('add-appart-modal'); emptyForm(); });

    onAction('publish-save', async (button) => {
      const editingId = state.editingApartmentId;
      const idleLabel = editingId ? 'Enregistrer les modifications' : 'Publier';
      const cancelButton = $('btn-cancel-add');
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.innerHTML = `<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> ${editingId ? 'Mise à jour' : 'Publication'} en cours...`;
      cancelButton.disabled = true;
      clearFieldErrors();
      setPublishFeedback('Vérification des informations...', 'info');
      try {
        requireRole('owner');
        const title = $('new-title').value.trim();
        const type = $('new-type').value;
        const commune = $('new-commune').value;
        const avenue = $('new-ref').value.trim();
        const landmark = $('new-landmark').value.trim();
        const reference = [avenue, landmark].filter(Boolean).join(' — ');
        const rates = Object.fromEntries(['hour', 'day', 'week', 'month'].map((key) => {
          const value = Number($(`price-${key}`).value);
          return [key, Number.isFinite(value) && value > 0 ? value : 0];
        }));
        let invalid = false;
        if (!title) { setFieldError('new-title', 'Saisissez le titre de l’annonce.'); invalid = true; }
        if (!type) { setFieldError('new-type', 'Choisissez le type de bien.'); invalid = true; }
        if (!commune) { setFieldError('new-commune', 'Choisissez la commune.'); invalid = true; }
        if (!avenue) { setFieldError('new-ref', 'Saisissez l’avenue.'); invalid = true; }
        if (!Object.values(rates).some((value) => value > 0)) { setFieldError('rates', 'Saisissez au moins un tarif supérieur à 0.'); invalid = true; }
        const photoCount = state.selectedFiles.length + state.selectedExistingPhotos.length;
        if (photoCount < 1 || photoCount > MAX_PHOTOS) {
          setFieldError('photos', 'Ajoutez entre 1 et 4 photos pour publier le bien.');
          invalid = true;
        }
        if (invalid) {
          const firstInvalid = document.querySelector('[aria-invalid="true"]') || $('photo-drop-zone');
          firstInvalid?.focus();
          firstInvalid?.scrollIntoView({ block: 'center', behavior: 'smooth' });
          throw new Error('Corrigez les champs signalés avant de publier.');
        }
        if (!navigator.onLine) throw new Error('La publication nécessite une connexion Internet. Réessayez lorsque vous serez en ligne.');

        const previous = editingId ? state.apartments.find((item) => item.id === editingId) : null;
        if (editingId && (!previous || (previous.ownerUid || previous.ownerId) !== state.user.uid)) throw new Error('Annonce introuvable ou accès refusé.');
        let photos = state.selectedExistingPhotos.map((photo) => photo.url);
        if (state.selectedFiles.length) {
          const fileCount = state.selectedFiles.length;
          setPublishFeedback(`Compression de ${fileCount} photo${fileCount > 1 ? 's' : ''} sur cet appareil...`, 'info');
          const dataUrls = await Promise.all(state.selectedFiles.map((file) => compressPhoto(file)));
          photos = photos.concat(dataUrls);
        }

        const id = editingId || doc(collection(db, 'apartments')).id;
        const makePayload = (photoList) => ({
          id,
          title,
          avenue,
          landmark,
          reference,
          rates,
          price: rates.month || rates.day || rates.hour || rates.week || 0,
          type,
          commune,
          ...selectedPhotos(),
          garantie: $('new-garantie').value.trim() || 'À discuter',
          snel: $('new-snel').value,
          water: $('new-water').value,
          mapsUrl: $('new-maps').value.trim(),
          photos: photoList,
          ownerId: state.user.uid,
          ownerUid: state.user.uid,
          ownerEmail: state.user.email,
          ownerName: state.user.name,
          ownerPhone: state.user.phone || '',
          ownerType: state.user.accountType || 'owner',
          status: 'publie',
          availabilityStatus: editingId ? availabilityStatusOf(previous) : 'Disponible',
          updatedAt: serverTimestamp(),
          ...(editingId ? {} : { createdAt: serverTimestamp() })
        });
        const fitted = await fitPhotosToDocument(photos, makePayload);
        setPublishFeedback('Enregistrement de l’annonce...', 'info');
        const payload = fitted.payload;
        if (editingId) {
          await updateDoc(doc(db, 'apartments', editingId), payload);
        } else {
          await setDoc(doc(db, 'apartments', id), payload);
        }

        const now = new Date();
        const saved = { ...payload, createdAt: previous?.createdAt || now, updatedAt: now };
        state.apartments = [...state.apartments.filter((item) => item.id !== id), saved];
        bus.emit('apartments:changed');
        closeModal('add-appart-modal');
        emptyForm();
        toast(editingId ? 'Bien mis à jour avec succès.' : 'Bien publié avec succès.', 'ok');
      } catch (error) {
        const visibleError = friendlyPublishError(error);
        console.error('[KAZA] Publication impossible', visibleError);
        setPublishFeedback(visibleError.message);
      } finally {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.textContent = state.editingApartmentId ? 'Enregistrer les modifications' : idleLabel;
        cancelButton.disabled = false;
      }
    });
  }
};
