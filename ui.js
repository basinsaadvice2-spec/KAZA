import { state } from './state.js';
export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const openModal = (id) => { $(id).style.display = 'flex'; };
export const closeModal = (id) => { $(id).style.display = 'none'; };

export function toast(msg, type = 'info') {
  const t = document.createElement('div');
  t.textContent = msg;
  const bg = type === 'error' ? '#ef4444' : type === 'ok' ? '#10b981' : '#4f46e5';
  t.style.cssText = `position:fixed;left:50%;bottom:92px;transform:translateX(-50%);max-width:90%;padding:12px 18px;border-radius:14px;font:600 13px 'Plus Jakarta Sans',sans-serif;color:#fff;z-index:30000;box-shadow:var(--shadow-md);background:${bg}`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

const PROTECTED = { 'scr-owner-dashboard': 'owner', 'scr-tenant-dashboard': 'tenant' };
export function showScreen(id) {
  const need = PROTECTED[id];
  if (need && state.user?.role !== need) { toast('Accès non autorisé.', 'error'); return false; }
  document.querySelectorAll('.screen-view').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
  window.scrollTo(0, 0);
  return true;
}

export const requireRole = (role) => { if (state.user?.role !== role) throw new Error('Action réservée à un autre type de compte.'); };

// Système d'actions : tout bouton porte data-action ; un bouton sans gestionnaire le signale au lieu de rester muet.
const handlers = new Map();
export const onAction = (name, fn) => handlers.set(name, fn);
export function bindActions(map) { Object.entries(map).forEach(([sel, name]) => document.querySelectorAll(sel).forEach(el => { el.dataset.action = name; })); }
export function initActions() {
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.dataset.busy) return;
    const fn = handlers.get(el.dataset.action);
    if (!fn) { console.warn('[KAZA] Action sans gestionnaire :', el.dataset.action); return toast('Action indisponible pour le moment.', 'error'); }
    el.dataset.busy = '1';
    try { await fn(el, e); } catch (err) { console.error(err); toast(err.message || 'Erreur inattendue', 'error'); } finally { delete el.dataset.busy; }
  });
}
