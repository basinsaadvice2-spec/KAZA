import { state } from './state.js';
import { $, esc, toast, onAction, requireRole } from './ui.js';
import { addView } from './views.js';
import { ensureChat, postMessage } from './chat-service.js';
import { notify } from './notify.js';
const recipients = () => state.apartments.filter(a => a.ownerUid === state.user.uid && a.status === 'Loué' && a.tenantUid);
function render(box) {
  box.innerHTML = `<div class="surface-box"><h4>Diffusion aux locataires actifs</h4><p class="muted-text">Destinataires : ${recipients().length} locataire(s) actif(s).</p>
    <div class="form-input-container no-icon"><textarea id="broadcast-msg" rows="4" placeholder="Votre message..."></textarea></div>
    <button class="btn-submit-form owner-theme" data-action="send-broadcast">Envoyer</button></div>`;
}
export default {
  name: 'broadcast',
  init() {
    addView('owner', 'owner-broadcast', render);
    onAction('send-broadcast', async () => {
      requireRole('owner');
      const text = $('broadcast-msg').value.trim(), targets = recipients();
      if (!text) throw new Error('Écrivez un message.');
      if (!targets.length) throw new Error('Aucun locataire actif à contacter.');
      if (!confirm(`Envoyer ce message à ${targets.length} locataire(s) ?`)) return;
      for (const a of targets) {
        const c = await ensureChat(a, a.tenantUid, a.tenantName);
        await postMessage(c.id, `📢 Diffusion : ${text}`, 'system');
        await notify(a.tenantUid, 'chat', 'Message du bailleur', text.slice(0, 80), { chatId: c.id });
      }
      $('broadcast-msg').value = ''; toast(`Message envoyé à ${targets.length} locataire(s).`, 'ok');
    });
  }
};
