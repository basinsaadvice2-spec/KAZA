import { initActions } from './core/ui.js';
import { initNav } from './core/views.js';
import theme from './plugins/theme.js';
import data from './plugins/data.js';
import catalog from './plugins/catalog.js';
import booking from './plugins/booking.js';
import owner from './plugins/owner.js';
import publish from './plugins/publish.js';
import auth from './plugins/auth.js';

// Chaque plugin est isolé : si l'un échoue, les autres continuent. L'authentification démarre en dernier.
const plugins = [theme, data, catalog, booking, owner, publish, auth];
window.__KAZA_PLUGINS__ = {};
initActions();
initNav();
for (const p of plugins) {
  try { await p.init(); window.__KAZA_PLUGINS__[p.name] = 'ok'; }
  catch (e) { console.error(`[KAZA] plugin « ${p.name} » en échec`, e); window.__KAZA_PLUGINS__[p.name] = 'erreur'; }
}
