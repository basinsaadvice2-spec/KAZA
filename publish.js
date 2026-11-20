import { db, storage, doc, setDoc, serverTimestamp, ref, uploadBytes, getDownloadURL } from './firebase.js';
import { state } from './state.js';
import { $, esc, toast, onAction, bindActions, closeModal, requireRole } from './ui.js';

const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const FIELDS = ['new-title', 'new-ref', 'new-landmark', 'price-hour', 'price-day', 'price-week', 'price-month', 'new-garantie', 'new-maps'];

function previews() {
  $('photo-counter').innerText = state.selectedFiles.length;
  $('photo-preview-container').innerHTML = state.selectedFiles.map((f, i) => `<div class="preview-item"><img src="${esc(URL.createObjectURL(f))}" alt=""><button type="button" class="btn-remove-photo" data-action="remove-photo" data-idx="${i}"><i class="fa-solid fa-xmark"></i></button></div>`).join('');
}
function reset() { FIELDS.forEach(id => { $(id).value = ''; }); state.selectedFiles = []; previews(); }

export default {
  name: 'publish',
  init() {
    bindActions({ '#btn-save-appart': 'publish-save', '#btn-cancel-add': 'publish-cancel', '#photo-drop-zone': 'pick-photos' });
    const input = $('new-photo');
    onAction('pick-photos', (el, e) => { if (e.target !== input) input.click(); });
    input.addEventListener('change', () => {
      for (const f of Array.from(input.files)) {
        if (state.selectedFiles.length >= 4) { toast('Maximum 4 photos.', 'error'); break; }
        if (!OK_TYPES.includes(f.type)) { toast(`${f.name} : format refusé (JPG, PNG ou WEBP).`, 'error'); continue; }
        if (f.size > 5 * 1024 * 1024) { toast(`${f.name} : plus de 5 Mo.`, 'error'); continue; }
        state.selectedFiles.push(f);
      }
      input.value = ''; previews();
    });
    onAction('remove-photo', (el) => { state.selectedFiles.splice(Number(el.dataset.idx), 1); previews(); });
    onAction('publish-cancel', () => closeModal('add-appart-modal'));

    onAction('publish-save', async () => {
      requireRole('owner');
      const title = $('new-title').value.trim(), avenue = $('new-ref').value.trim(), landmark = $('new-landmark').value.trim();
      const reference = [avenue, landmark].filter(Boolean).join(' — ');
      const rates = { hour: Number($('price-hour').value) || 0, day: Number($('price-day').value) || 0, week: Number($('price-week').value) || 0, month: Number($('price-month').value) || 0 };
      if (!title || !avenue) throw new Error('Remplissez le titre et l\'avenue.');
      if (!Object.values(rates).some(v => v > 0)) throw new Error('Renseignez au moins un tarif.');
      if (!state.selectedFiles.length) throw new Error('Ajoutez au moins une photo.');
      const photos = [], photoPaths = [];
      for (let i = 0; i < state.selectedFiles.length; i++) {
        const f = state.selectedFiles[i], path = `apartments/${state.user.uid}/${Date.now()}_${i}_${f.name.replace(/[^\w.-]/g, '_')}`;
        const r = ref(storage, path);
        await uploadBytes(r, f, { contentType: f.type });
        photos.push(await getDownloadURL(r)); photoPaths.push(path);
      }
      const id = 'apt_' + Date.now();
      await setDoc(doc(db, 'apartments', id), {
        id, title, avenue, landmark, reference, rates, price: rates.month || rates.day || rates.hour || rates.week || 0,
        type: $('new-type').value, commune: $('new-commune').value, garantie: $('new-garantie').value.trim() || 'À discuter',
        snel: $('new-snel').value, water: $('new-water').value, mapsUrl: $('new-maps').value.trim(),
        photos, photoUrl: photos[0], photoPaths, status: 'Disponible', createdAt: serverTimestamp(),
        ownerUid: state.user.uid, ownerEmail: state.user.email, ownerName: state.user.name, ownerPhone: state.user.phone || ''
      });
      closeModal('add-appart-modal'); reset();
      toast('Annonce publiée.', 'ok');
    });
  }
};
