import { initActions } from './ui.js';
import { initNav } from './views.js';
import theme from './theme.js';
import data from './data.js';
import catalog from './catalog.js';
import booking from './booking.js';
import owner from './owner.js';
import publish from './publish.js';
import notifications from './notifications.js';
import payments from './payments.js';
import chat from './chat.js';
import broadcast from './broadcast.js';
import auth from './auth.js';

// Chaque plugin est isolé : si l'un échoue, les autres continuent. L'authentification démarre en dernier.
const plugins = [theme, data, catalog, booking, owner, publish, notifications, payments, chat, broadcast, auth];
window.__KAZA_PLUGINS__ = {};
initActions();
initNav();
for (const p of plugins) {
  try { await p.init(); window.__KAZA_PLUGINS__[p.name] = 'ok'; }
  catch (e) { console.error(`[KAZA] plugin « ${p.name} » en échec`, e); window.__KAZA_PLUGINS__[p.name] = 'erreur'; }
}
