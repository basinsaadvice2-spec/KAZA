import { db, storage, collection, doc, setDoc, updateDoc, serverTimestamp, ref, uploadBytesResumable, getDownloadURL, deleteObject } from './firebase.js';
import { state } from './state.js';
import { $, esc, toast, onAction, bindActions, closeModal, openModal, requireRole } from './ui.js';

const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
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

async function optimizePhoto(file) {
  if (typeof createImageBitmap !== 'function') return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    const longestSide = Math.max(bitmap.width, bitmap.height);
    if (longestSide <= 1600 && file.size <= 512 * 1024) return file;

    const scale = Math.min(1, 1600 / longestSide);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
    if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return file;

    const name = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${name}.webp`, { type: 'image/webp', lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    bitmap?.close?.();
  }
}

function uploadPhoto(storageRef, file, onProgress) {
  const task = uploadBytesResumable(storageRef, file, { contentType: file.type });
  return new Promise((resolve, reject) => {
    task.on('state_changed', (snapshot) => {
      onProgress(snapshot.bytesTransferred, snapshot.totalBytes);
    }, reject, () => resolve(task.snapshot));
  });
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
  state.selectedExistingPhotos = (apartment.photos || (apartment.photoUrl ? [apartment.photoUrl] : [])).map((url, index) => ({
    url,
    path: apartment.photoPaths?.[index] || null
  }));
  state.editingApartmentId = apartment.id;
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
  if (code.startsWith('storage/')) {
    return new Error('L’envoi de la photo a échoué dans Firebase Storage. Vérifiez que le stockage et son forfait sont activés, ainsi que les règles du bucket.', { cause: error });
  }
  if (code === 'permission-denied') {
    return new Error('Firebase a refusé cette publication. Vérifiez que ce compte a bien le rôle Bailleur et que les règles Firestore sont à jour.', { cause: error });
  }
  return error;
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
    onAction('open-publish', () => { requireRole('owner'); emptyForm(); openModal('add-appart-modal'); });
    onAction('edit-apart', (el) => {
      const apartment = state.apartments.find((item) => item.id === el.dataset.id);
      setEditForm(apartment);
    });
    onAction('pick-photos', (el, event) => { if (event.target !== input) input.click(); });
    input.addEventListener('change', () => {
      for (const file of Array.from(input.files || [])) {
        if (state.selectedExistingPhotos.length + state.selectedFiles.length >= 4) { toast('Maximum 4 photos.', 'error'); break; }
        if (!OK_TYPES.includes(file.type)) { toast(`${file.name} : format refusé (JPG, PNG ou WEBP).`, 'error'); continue; }
        if (file.size > 5 * 1024 * 1024) { toast(`${file.name} : plus de 5 Mo.`, 'error'); continue; }
        state.selectedFiles.push(file);
      }
      input.value = '';
      previews();
    });
    onAction('remove-photo', (el) => { state.selectedFiles.splice(Number(el.dataset.idx), 1); previews(); });
    onAction('remove-existing-photo', (el) => { state.selectedExistingPhotos.splice(Number(el.dataset.idx), 1); previews(); });
    onAction('publish-cancel', () => { closeModal('add-appart-modal'); emptyForm(); });

    onAction('publish-save', async (button) => {
      requireRole('owner');
      const editingId = state.editingApartmentId;
      const idleLabel = editingId ? 'Enregistrer les modifications' : 'Publier';
      const cancelButton = $('btn-cancel-add');
      const uploadedPaths = [];
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = editingId ? 'Mise à jour…' : 'Préparation…';
      cancelButton.disabled = true;
      setPublishFeedback('Vérification des informations…', 'info');
      try {
        const title = $('new-title').value.trim();
        const avenue = $('new-ref').value.trim();
        const landmark = $('new-landmark').value.trim();
        const reference = [avenue, landmark].filter(Boolean).join(' — ');
        const rates = Object.fromEntries(['hour', 'day', 'week', 'month'].map((key) => {
          const value = Number($(`price-${key}`).value);
          return [key, Number.isFinite(value) && value > 0 ? value : 0];
        }));
        if (!title || !avenue) throw new Error('Remplissez le titre et l’avenue.');
        if (!Object.values(rates).some((value) => value > 0)) throw new Error('Renseignez au moins un tarif positif.');
        if (!state.selectedFiles.length && !state.selectedExistingPhotos.length) throw new Error('Ajoutez au moins une photo pour publier cette annonce.');
        if (!navigator.onLine) throw new Error('La publication nécessite une connexion Internet. Réessayez lorsque vous serez en ligne.');

        const previous = editingId ? state.apartments.find((item) => item.id === editingId) : null;
        if (editingId && (!previous || previous.ownerUid !== state.user.uid)) throw new Error('Annonce introuvable ou accès refusé.');
        const photos = state.selectedExistingPhotos.map((photo) => photo.url);
        const photoPaths = state.selectedExistingPhotos.map((photo) => photo.path);
        if (state.selectedFiles.length) {
          const fileCount = state.selectedFiles.length;
          button.textContent = `Optimisation de ${fileCount} photo${fileCount > 1 ? 's' : ''}…`;
          setPublishFeedback('Réduction des images pour accélérer leur envoi…', 'info');
          const optimizedFiles = await Promise.all(state.selectedFiles.map(optimizePhoto));
          button.textContent = `Envoi de ${fileCount} photo${fileCount > 1 ? 's' : ''}…`;
          setPublishFeedback(`Envoi de ${fileCount} photo${fileCount > 1 ? 's' : ''} vers le stockage…`, 'info');
          const transferredByPhoto = optimizedFiles.map(() => 0);
          const totalBytes = optimizedFiles.reduce((sum, file) => sum + file.size, 0);
          let lastDisplayedPercent = -1;
          let lastAnnouncedPercent = 0;
          const uploadResults = await Promise.allSettled(optimizedFiles.map(async (file, index) => {
            const path = `apartments/${state.user.uid}/${crypto.randomUUID()}_${index}_${file.name.replace(/[^\w.-]/g, '_')}`;
            const storageRef = ref(storage, path);
            const snapshot = await uploadPhoto(storageRef, file, (transferred) => {
              transferredByPhoto[index] = transferred;
              const uploaded = transferredByPhoto.reduce((sum, value) => sum + value, 0);
              const percentage = totalBytes ? Math.min(100, Math.round(uploaded / totalBytes * 100)) : 100;
              if (percentage !== lastDisplayedPercent) {
                button.textContent = `Envoi des photos… ${percentage}%`;
                lastDisplayedPercent = percentage;
              }
              if (percentage === 100 || percentage - lastAnnouncedPercent >= 10) {
                setPublishFeedback(`Envoi des photos… ${percentage} % terminé`, 'info');
                lastAnnouncedPercent = percentage;
              }
            });
            uploadedPaths.push(path);
            return { url: await getDownloadURL(snapshot.ref), path };
          }));
          const failedUpload = uploadResults.find((result) => result.status === 'rejected');
          if (failedUpload) throw failedUpload.reason;
          uploadResults.forEach((result) => {
            if (result.status === 'fulfilled') {
              photos.push(result.value.url);
              photoPaths.push(result.value.path);
            }
          });
        }

        button.textContent = 'Enregistrement…';
        setPublishFeedback('Enregistrement de l’annonce…', 'info');
        const id = editingId || doc(collection(db, 'apartments')).id;
        const payload = {
          id,
          title,
          avenue,
          landmark,
          reference,
          rates,
          price: rates.month || rates.day || rates.hour || rates.week || 0,
          type: $('new-type').value,
          commune: $('new-commune').value,
          ...selectedPhotos(),
          garantie: $('new-garantie').value.trim() || 'À discuter',
          snel: $('new-snel').value,
          water: $('new-water').value,
          mapsUrl: $('new-maps').value.trim(),
          photos,
          photoUrl: photos[0],
          photoPaths,
          ownerUid: state.user.uid,
          ownerEmail: state.user.email,
          ownerName: state.user.name,
          ownerPhone: state.user.phone || '',
          ownerType: state.user.accountType || 'owner',
          updatedAt: serverTimestamp(),
          ...(editingId ? {} : { status: 'Disponible', createdAt: serverTimestamp() })
        };
        if (editingId) await updateDoc(doc(db, 'apartments', editingId), payload);
        else await setDoc(doc(db, 'apartments', id), payload);

        const keptPaths = new Set(photoPaths.filter(Boolean));
        const removedPaths = (previous?.photoPaths || []).filter((path) => path && !keptPaths.has(path));
        await Promise.allSettled(removedPaths.map((path) => deleteObject(ref(storage, path))));
        closeModal('add-appart-modal');
        emptyForm();
        toast(editingId ? 'Annonce mise à jour.' : 'Annonce publiée.', 'ok');
      } catch (error) {
        await Promise.allSettled(uploadedPaths.map((path) => deleteObject(ref(storage, path))));
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
