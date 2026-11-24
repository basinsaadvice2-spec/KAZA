import { auth, db, doc, getDoc, setDoc, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut, setPersistence, browserLocalPersistence } from './firebase.js';
import { state } from './state.js';
import { bus } from './bus.js';
import { $, toast, showScreen, onAction, bindActions } from './ui.js';
import { isValidPhone } from './format.js';

const ERR = {
  'auth/invalid-credential': 'Email ou mot de passe incorrect.', 'auth/wrong-password': 'Email ou mot de passe incorrect.',
  'auth/user-not-found': 'Email ou mot de passe incorrect.', 'auth/email-already-in-use': 'Cet email est déjà utilisé.',
  'auth/weak-password': 'Mot de passe trop faible (6 caractères minimum).', 'auth/invalid-email': 'Adresse email invalide.',
  'auth/network-request-failed': 'Connexion réseau indisponible.', 'auth/too-many-requests': 'Trop de tentatives. Réessayez plus tard.'
};
let registering = false;
const label = (r) => r === 'owner' ? 'Bailleur' : 'Locataire';

function refreshTexts() {
  const reg = state.authMode === 'register', r = label(state.selectedRole);
  $('register-fields').style.display = reg ? 'block' : 'none';
  $('owner-account-type-wrap').style.display = reg && state.selectedRole === 'owner' ? 'block' : 'none';
  $('auth-title').innerText = `${reg ? 'Inscription' : 'Connexion'} ${r}`;
  $('auth-subtitle').innerText = `Accès sécurisé (${r}).`;
  $('btn-auth-submit').innerText = reg ? 'Créer mon compte' : 'Continuer';
  $('btn-auth-submit').className = `btn-submit-form ${state.selectedRole === 'owner' ? 'owner-theme' : 'tenant-theme'}`;
  $('auth-toggle-link').innerText = reg ? 'Déjà inscrit ? Se connecter' : "Pas encore de compte ? S'inscrire";
}

async function startSession(fbUser) {
  const snap = await getDoc(doc(db, 'users', fbUser.uid)); // rôle relu côté serveur à chaque session
  if (!snap.exists()) { await signOut(auth); return toast('Profil introuvable.', 'error'); }
  const profile = snap.data();
  if (state.selectedRole && state.selectedRole !== profile.role) {
    await signOut(auth);
    state.selectedRole = null;
    showScreen('scr-role-select');
    return toast(`Ce compte est un compte ${label(profile.role)}. Choisissez le bon espace.`, 'error');
  }
  state.user = { ...profile, accountType: profile.accountType || (profile.role === 'owner' ? 'owner' : 'tenant'), uid: fbUser.uid };
  await setDoc(doc(db, 'publicProfiles', fbUser.uid), {
    uid: fbUser.uid,
    name: state.user.name || '',
    phone: state.user.phone || '',
    role: state.user.role,
    accountType: state.user.accountType
  }, { merge: true }).catch((error) => console.warn('[KAZA] Profil public non synchronisé', error));
  bus.emit('session:start', state.user);
  showScreen(profile.role === 'owner' ? 'scr-owner-dashboard' : 'scr-tenant-dashboard');
}

export default {
  name: 'auth',
  async init() {
    bindActions({ '.role-interactive-card': 'select-role', '#btn-back-role': 'back-role', '#btn-auth-submit': 'auth-submit', '#auth-toggle-link': 'auth-toggle', '.btn-logout': 'logout' });
    document.querySelectorAll('.role-interactive-card').forEach((card) => card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); card.click(); }
    }));

    onAction('select-role', (el) => { state.selectedRole = el.dataset.role; localStorage.setItem('kaza_intended_role', state.selectedRole); state.authMode = 'login'; refreshTexts(); showScreen('scr-auth'); });
    onAction('back-role', () => showScreen('scr-role-select'));
    onAction('auth-toggle', () => { state.authMode = state.authMode === 'login' ? 'register' : 'login'; refreshTexts(); });
    $('auth-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-auth-submit').click(); });

    onAction('auth-submit', async () => {
      const email = $('auth-email').value.trim().toLowerCase(), pass = $('auth-password').value;
      if (!email || !pass) return toast("Veuillez remplir l'email et le mot de passe.", 'error');
      let created = null;
      try {
        if (state.authMode === 'register') {
          const name = $('auth-name').value.trim(), phone = $('auth-phone').value.trim();
          if (!name || !isValidPhone(phone)) return toast('Nom et téléphone valides obligatoires (ex : +243810000000).', 'error');
          if (pass.length < 6) return toast('Mot de passe : 6 caractères minimum.', 'error');
          registering = true;
          created = await createUserWithEmailAndPassword(auth, email, pass);
          const role = state.selectedRole || localStorage.getItem('kaza_intended_role') || 'tenant';
          const accountType = role === 'owner' ? $('auth-account-type').value : 'tenant';
          await setDoc(doc(db, 'users', created.user.uid), { uid: created.user.uid, email, name, phone, role, accountType });
          registering = false;
          await startSession(created.user);
        } else {
          await signInWithEmailAndPassword(auth, email, pass);
        }
      } catch (e) {
        registering = false;
        if (created) await created.user.delete().catch(() => {}); // pas de compte sans profil
        toast(ERR[e.code] || e.message, 'error');
      }
    });

    onAction('logout', async () => { state.selectedRole = null; localStorage.removeItem('kaza_intended_role'); await signOut(auth); });

    await setPersistence(auth, browserLocalPersistence).catch(console.error);
    onAuthStateChanged(auth, async (fb) => {
      if (registering) return;
      if (!fb) { if (state.user) { state.user = null; bus.emit('session:end'); } return showScreen('scr-role-select'); }
      if (state.user?.uid === fb.uid) return;
      try { await startSession(fb); } catch (e) { console.error(e); toast('Impossible de charger le profil (' + (e.code || e.message) + ').', 'error'); }
    });
  }
};
