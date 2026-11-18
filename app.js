import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDoc, updateDoc, deleteDoc, onSnapshot, arrayUnion } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyDIZPv2R6N2XfTPepTPSHk3WKVLqjkpy6g",
  authDomain: "kaza-bf0dc.firebaseapp.com",
  projectId: "kaza-bf0dc",
  storageBucket: "kaza-bf0dc.firebasestorage.app",
  messagingSenderId: "785266371417",
  appId: "1:785266371417:web:9dc8df1cfef4e12ec63a48",
  measurementId: "G-MTDDTVT839"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

let state = {
    selectedRole: null,
    authMode: 'login',
    user: null,
    apartments: [],
    chats: [],
    activeChatId: null
};

function showScreen(id) {
    document.querySelectorAll('.screen-view').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

document.querySelectorAll('.role-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        state.selectedRole = btn.dataset.role;
        localStorage.setItem('kaza_intended_role', state.selectedRole);
        const label = state.selectedRole === 'owner' ? 'Bailleur' : 'Locataire';
        document.getElementById('auth-title').innerText = `Connexion ${label}`;
        document.getElementById('role-security-info').innerText = `Espace réservé : ${label}`;
        showScreen('scr-auth');
    });
});

document.getElementById('btn-back-role').addEventListener('click', () => showScreen('scr-role-select'));

document.getElementById('auth-toggle-link').addEventListener('click', () => {
    state.authMode = state.authMode === 'login' ? 'register' : 'login';
    const label = state.selectedRole === 'owner' ? 'Bailleur' : 'Locataire';
    document.getElementById('register-fields').style.display = state.authMode === 'register' ? 'block' : 'none';
    document.getElementById('auth-title').innerText = `${state.authMode === 'login' ? 'Connexion' : 'Inscription'} ${label}`;
    document.getElementById('btn-auth-submit').innerText = state.authMode === 'login' ? 'Continuer' : 'Créer un compte';
    document.getElementById('auth-toggle-link').innerText = state.authMode === 'login' ? "Pas encore de compte ? S'inscrire" : "Déjà inscrit ? Se connecter";
});

// AUTHENTIFICATION & VERROUILLAGE DES RÔLES
document.getElementById('btn-auth-submit').addEventListener('click', async () => {
    const email = document.getElementById('auth-email').value.trim().toLowerCase();
    const pass = document.getElementById('auth-password').value;
    const intendedRole = state.selectedRole || localStorage.getItem('kaza_intended_role') || 'tenant';

    if (!email || !pass) return alert("Veuillez remplir l'email et le mot de passe.");

    const btn = document.getElementById('btn-auth-submit');
    btn.disabled = true;
    btn.innerText = "Vérification...";

    try {
        if (state.authMode === 'register') {
            const name = document.getElementById('auth-name').value.trim();
            const phone = document.getElementById('auth-phone').value.trim();
            if (!name || !phone) {
                btn.disabled = false;
                btn.innerText = "Créer un compte";
                return alert("Nom complet et numéro WhatsApp obligatoires.");
            }
            const cred = await createUserWithEmailAndPassword(auth, email, pass);
            await setDoc(doc(db, "users", cred.user.uid), {
                uid: cred.user.uid, email, name, phone, role: intendedRole, createdAt: new Date().toISOString()
            });
        } else {
            await signInWithEmailAndPassword(auth, email, pass);
        }
    } catch (e) {
        alert("Erreur : " + e.message);
    } finally {
        btn.disabled = false;
        btn.innerText = state.authMode === 'login' ? 'Continuer' : 'Créer un compte';
    }
});

document.querySelectorAll('.btn-logout').forEach(b => b.addEventListener('click', async () => {
    localStorage.removeItem('kaza_intended_role');
    await signOut(auth);
}));

document.querySelectorAll('.theme-toggle').forEach(b => b.addEventListener('click', () => document.body.classList.toggle('dark-mode')));

onAuthStateChanged(auth, async (firebaseUser) => {
    if (!firebaseUser) {
        state.user = null;
        return showScreen('scr-role-select');
    }

    const userSnap = await getDoc(doc(db, "users", firebaseUser.uid));
    if (!userSnap.exists()) {
        await signOut(auth);
        return alert("Profil introuvable.");
    }

    const userData = userSnap.data();
    const intendedRole = state.selectedRole || localStorage.getItem('kaza_intended_role');

    if (intendedRole && userData.role !== intendedRole) {
        const vraiRole = userData.role === 'owner' ? 'Bailleur' : 'Locataire';
        const porteTente = intendedRole === 'owner' ? 'Bailleur' : 'Locataire';
        await signOut(auth);
        alert(`Accès refusé : ce compte est enregistré comme ${vraiRole}. Veuillez vous connecter via l'espace ${vraiRole} (et non ${porteTente}).`);
        return showScreen('scr-role-select');
    }

    state.user = userData;

    onSnapshot(collection(db, "apartments"), (snap) => {
        state.apartments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (state.user.role === 'tenant') {
            const activeTab = document.querySelector('#scr-tenant .tab-item.active')?.dataset.tab;
            if (activeTab === 'my-rental') renderMyRental();
            else if (activeTab !== 'tenant-chats') renderCatalog();
        } else {
            const activeTab = document.querySelector('#scr-owner .tab-item.active')?.dataset.tab;
            if (activeTab === 'owner-apparts') renderOwnerApparts();
        }
    });

    onSnapshot(collection(db, "chats"), (snap) => {
        state.chats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (state.activeChatId) renderChatMessages();
    });

    if (state.user.role === 'owner') {
        showScreen('scr-owner');
        renderOwnerApparts();
    } else {
        showScreen('scr-tenant');
        renderCatalog();
    }
});

// ================= ESPACE BAILLEUR =================
document.querySelectorAll('#scr-owner .tab-item').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('#scr-owner .tab-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (btn.dataset.tab === 'owner-apparts') renderOwnerApparts();
        if (btn.dataset.tab === 'owner-add') renderAddAppartForm();
        if (btn.dataset.tab === 'owner-broadcast') renderBroadcastView();
        if (btn.dataset.tab === 'owner-chats') renderChatList('owner-content');
    });
});

function renderAddAppartForm() {
    document.getElementById('owner-content').innerHTML = `
        <div class="card form-card">
            <h3 style="margin-bottom:14px;">Nouveau bien immobilier</h3>
            <div class="input-group">
                <label>Titre de l'annonce</label>
                <input type="text" id="new-title" placeholder="Ex: Appartement 2 chambres">
            </div>
            
            <div class="filter-row">
                <div class="input-group">
                    <label>Type</label>
                    <select id="new-type">
                        <option value="Appartement">Appartement</option>
                        <option value="Maison">Maison</option>
                        <option value="Studio">Studio</option>
                    </select>
                </div>
                <div class="input-group">
                    <label>Commune</label>
                    <select id="new-commune">
                        <option value="Gombe">Gombe</option><option value="Ngaliema">Ngaliema</option>
                        <option value="Limete">Limete</option><option value="Lingwala">Lingwala</option>
                        <option value="Kintambo">Kintambo</option><option value="Bandalungwa">Bandalungwa</option>
                        <option value="Kasa-Vubu">Kasa-Vubu</option><option value="Lemba">Lemba</option>
                        <option value="Matete">Matete</option><option value="Masina">Masina</option>
                        <option value="Ndjili">Ndjili</option><option value="Mont-Ngafula">Mont-Ngafula</option>
                    </select>
                </div>
            </div>

            <div class="input-group">
                <label>Avenue et Point de référence</label>
                <input type="text" id="new-ref" placeholder="Ex: Av. Kasavubu, Réf: Arrêt Socimat">
            </div>

            <div class="filter-row">
                <div class="input-group">
                    <label>Loyer Mensuel ($)</label>
                    <input type="number" id="new-price" placeholder="350">
                </div>
                <div class="input-group">
                    <label>Garantie locative</label>
                    <input type="text" id="new-garantie" placeholder="Ex: 3 mois + 1">
                </div>
            </div>

            <div class="filter-row">
                <div class="input-group">
                    <label>Électricité (SNEL)</label>
                    <select id="new-snel">
                        <option value="Cash Power">Cash Power</option>
                        <option value="Forfait">Forfait SNEL</option>
                        <option value="Groupe/Solaire">Groupe / Solaire</option>
                    </select>
                </div>
                <div class="input-group">
                    <label>Accès Eau</label>
                    <select id="new-water">
                        <option value="Regideso">Regideso</option>
                        <option value="Forage/Citerne">Forage / Citerne</option>
                    </select>
                </div>
            </div>

            <div class="input-group">
                <label>Lien Google Maps (Optionnel)</label>
                <input type="url" id="new-maps" placeholder="https://maps.google.com/...">
            </div>

            <div class="input-group">
                <label>Photo du logement</label>
                <input type="file" id="new-photo" accept="image/*">
            </div>

            <button id="btn-save-appart" class="btn-main">Publier l'annonce</button>
        </div>
    `;

    document.getElementById('btn-save-appart').addEventListener('click', async () => {
        const title = document.getElementById('new-title').value.trim();
        const price = Number(document.getElementById('new-price').value);
        const refPoint = document.getElementById('new-ref').value.trim();
        if (!title || !price || !refPoint) return alert("Remplissez le titre, le prix et la référence.");

        const btn = document.getElementById('btn-save-appart');
        btn.innerText = "Publication...";
        btn.disabled = true;

        try {
            let photoUrl = "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800";
            const fileInput = document.getElementById('new-photo');
            if (fileInput.files.length > 0) {
                const file = fileInput.files[0];
                const storageRef = ref(storage, `apartments/${state.user.uid}/${Date.now()}_${file.name}`);
                await uploadBytes(storageRef, file);
                photoUrl = await getDownloadURL(storageRef);
            }

            const id = "apt_" + Date.now();
            await setDoc(doc(db, "apartments", id), {
                id, title,
                type: document.getElementById('new-type').value,
                commune: document.getElementById('new-commune').value,
                price,
                reference: refPoint,
                garantie: document.getElementById('new-garantie').value.trim() || "À discuter",
                snel: document.getElementById('new-snel').value,
                water: document.getElementById('new-water').value,
                mapsUrl: document.getElementById('new-maps').value.trim(),
                photoUrl,
                status: "Disponible",
                ownerUid: state.user.uid,
                ownerEmail: state.user.email,
                ownerName: state.user.name,
                ownerPhone: state.user.phone || "",
                tenantUid: null, tenantEmail: null, tenantName: null,
                paymentStatus: null, receiptDate: null
            });

            alert("Bien publié !");
            document.querySelector('#scr-owner .tab-item[data-tab="owner-apparts"]').click();
        } catch (err) {
            alert("Erreur : " + err.message);
            btn.innerText = "Publier l'annonce";
            btn.disabled = false;
        }
    });
}

function renderOwnerApparts() {
    const myApparts = state.apartments.filter(a => a.ownerEmail === state.user.email);
    const container = document.getElementById('owner-content');
    if (myApparts.length === 0) {
        container.innerHTML = `<p style="text-align:center; color:var(--text-sub); margin-top:32px; font-size:13px;">Aucun bien publié pour le moment.</p>`;
        return;
    }

    container.innerHTML = myApparts.map(a => `
        <div class="card">
            <img src="${a.photoUrl}" class="listing-img">
            <div class="listing-body">
                <div class="listing-header">
                    <h3>${a.title}</h3>
                    <span class="status-pill ${a.status === 'Disponible' ? 'status-available' : 'status-rented'}">${a.status}</span>
                </div>
                <div class="price-tag" style="margin-top:4px;">${a.price} $ / mois</div>
                <p class="location-text">${a.commune} — ${a.reference}</p>
                
                ${a.tenantName ? `
                    <div style="margin-top:12px; padding:12px; background:var(--accent-soft); border-radius:10px; font-size:13px;">
                        <strong>Locataire :</strong> ${a.tenantName}<br>
                        <strong>Loyer :</strong> ${a.paymentStatus || 'En attente'}
                        ${a.paymentStatus === 'Payé' ? `<button class="btn-main" style="margin-top:10px;" onclick="window.confirmPayment('${a.id}')">Valider réception & Quittance</button>` : ''}
                    </div>
                ` : `
                    <button class="btn-danger-outline" onclick="window.deleteAppart('${a.id}')">Supprimer l'annonce</button>
                `}
            </div>
        </div>
    `).join('');
}

window.confirmPayment = async (id) => {
    const dateStr = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
    await updateDoc(doc(db, "apartments", id), { paymentStatus: "Confirmé", receiptDate: dateStr });
    alert("Loyer validé !");
};

window.deleteAppart = async (id) => {
    if (!confirm("Supprimer ce bien ?")) return;
    await deleteDoc(doc(db, "apartments", id));
};

function renderBroadcastView() {
    const myTenants = state.apartments.filter(a => a.ownerEmail === state.user.email && a.tenantEmail);
    document.getElementById('owner-content').innerHTML = `
        <div class="card form-card">
            <h3 style="margin-bottom:6px;">Diffusion aux Locataires</h3>
            <p style="font-size:12px; color:var(--text-sub); margin-bottom:12px;">Envoyer un message groupé à vos ${myTenants.length} locataire(s) actif(s).</p>
            <div class="input-group">
                <textarea id="broadcast-msg" rows="4" placeholder="Écrivez votre message..."></textarea>
            </div>
            <button id="btn-send-broadcast" class="btn-main">Envoyer à tous</button>
        </div>
    `;

    document.getElementById('btn-send-broadcast').addEventListener('click', async () => {
        const txt = document.getElementById('broadcast-msg').value.trim();
        if (!txt || myTenants.length === 0) return alert("Message vide ou aucun locataire actif.");
        for (const apt of myTenants) {
            const chatId = `${apt.tenantEmail}_${state.user.email}`.replace(/[.@]/g, '_');
            const chatRef = doc(db, "chats", chatId);
            const snap = await getDoc(chatRef);
            const msgObj = { sender: state.user.email, text: `[Communiqué] ${txt}`, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
            if (snap.exists()) await updateDoc(chatRef, { messages: arrayUnion(msgObj) });
            else await setDoc(chatRef, { id: chatId, tenantEmail: apt.tenantEmail, tenantName: apt.tenantName, ownerEmail: state.user.email, ownerName: state.user.name, context: apt.title, messages: [msgObj] });
        }
        alert("Message diffusé !");
        document.getElementById('broadcast-msg').value = "";
    });
}

// ================= ESPACE LOCATAIRE =================
['filter-search', 'filter-commune', 'filter-type', 'filter-max-price', 'filter-snel', 'filter-water'].forEach(id => {
    document.getElementById(id).addEventListener('input', renderCatalog);
});

document.querySelectorAll('#scr-tenant .tab-item').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('#scr-tenant .tab-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tenant-search-panel').style.display = btn.dataset.tab === 'catalog' ? 'block' : 'none';
        if (btn.dataset.tab === 'catalog') renderCatalog();
        if (btn.dataset.tab === 'my-rental') renderMyRental();
        if (btn.dataset.tab === 'tenant-chats') renderChatList('tenant-content');
    });
});

function renderCatalog() {
    const q = document.getElementById('filter-search').value.toLowerCase();
    const comm = document.getElementById('filter-commune').value;
    const type = document.getElementById('filter-type').value;
    const maxP = Number(document.getElementById('filter-max-price').value);
    const snel = document.getElementById('filter-snel').value;
    const water = document.getElementById('filter-water').value;

    const filtered = state.apartments.filter(a => {
        if (a.status !== 'Disponible') return false;
        if (comm && a.commune !== comm) return false;
        if (type && a.type !== type) return false;
        if (maxP && a.price > maxP) return false;
        if (snel && a.snel !== snel) return false;
        if (water && a.water !== water) return false;
        if (q && !(`${a.title} ${a.commune} ${a.reference}`.toLowerCase().includes(q))) return false;
        return true;
    });

    const container = document.getElementById('tenant-content');
    if (filtered.length === 0) {
        container.innerHTML = `<p style="text-align:center; color:var(--text-sub); margin-top:32px; font-size:13px;">Aucun logement disponible pour ces critères.</p>`;
        return;
    }

    container.innerHTML = filtered.map(a => {
        const cleanPhone = (a.ownerPhone || "").replace(/[^0-9]/g, '');
        const waMsg = encodeURIComponent(`Bonjour ${a.ownerName}, je suis intéressé par votre bien "${a.title}" à ${a.commune} (${a.price}$/mois) sur Kaza.`);
        return `
        <div class="card">
            <img src="${a.photoUrl}" class="listing-img">
            <div class="listing-body">
                <div class="listing-header">
                    <h3>${a.title}</h3>
                    <span class="price-tag">${a.price} $</span>
                </div>
                <p class="location-text">${a.commune} — ${a.reference}</p>
                ${a.mapsUrl ? `<a href="${a.mapsUrl}" target="_blank" class="maps-link">Voir sur Google Maps</a>` : ''}
                
                <div class="specs-list">
                    <span class="spec-pill">${a.type || 'Logement'}</span>
                    <span class="spec-pill">${a.snel}</span>
                    <span class="spec-pill">${a.water}</span>
                    <span class="spec-pill">Garantie : ${a.garantie}</span>
                </div>

                ${cleanPhone ? `
                <div class="btn-group-row">
                    <a href="tel:+${cleanPhone}" class="btn-contact"><i class="fa-solid fa-phone"></i> Appeler</a>
                    <a href="https://wa.me/${cleanPhone}?text=${waMsg}" target="_blank" class="btn-contact"><i class="fa-brands fa-whatsapp"></i> WhatsApp</a>
                </div>` : ''}

                <div class="btn-group-row">
                    <button class="btn-outline" onclick="window.openChat('${a.ownerEmail}', '${a.ownerName}', '${a.title}')">Message</button>
                    <button class="btn-main" onclick="window.bookAppart('${a.id}')">Réserver</button>
                </div>
            </div>
        </div>`;
    }).join('');
}

window.bookAppart = async (id) => {
    if (!confirm("Confirmer la réservation de ce logement ?")) return;
    await updateDoc(doc(db, "apartments", id), {
        status: "Loué", tenantUid: state.user.uid, tenantEmail: state.user.email, tenantName: state.user.name, paymentStatus: "En attente"
    });
    alert("Logement réservé !");
};

function renderMyRental() {
    const mine = state.apartments.filter(a => a.tenantEmail === state.user.email);
    const container = document.getElementById('tenant-content');
    if (mine.length === 0) {
        container.innerHTML = `<p style="text-align:center; color:var(--text-sub); margin-top:32px; font-size:13px;">Vous n'occupez aucun logement actuellement.</p>`;
        return;
    }

    container.innerHTML = mine.map(a => `
        <div class="card form-card">
            <h3>${a.title} (${a.commune})</h3>
            <p class="price-tag" style="margin:6px 0;">${a.price} $ / mois</p>
            <p style="font-size:13px; color:var(--text-sub);">Bailleur : ${a.ownerName}</p>
            <p style="font-size:13px; margin:8px 0 14px;">Statut loyer : <strong>${a.paymentStatus}</strong></p>
            
            ${a.paymentStatus !== 'Confirmé' ? `<button class="btn-main" onclick="window.notifyRentPaid('${a.id}')">Signaler le paiement du loyer</button>` : ''}
            ${a.paymentStatus === 'Confirmé' ? `<button class="btn-main" onclick="window.viewReceipt('${a.id}')">Afficher ma quittance</button>` : ''}
            
            <button class="btn-danger-outline" onclick="window.leaveAppart('${a.id}')">Signaler mon départ</button>
        </div>
    `).join('');
}

window.notifyRentPaid = async (id) => {
    await updateDoc(doc(db, "apartments", id), { paymentStatus: "Payé" });
    alert("Paiement signalé au bailleur.");
    renderMyRental();
};

window.leaveAppart = async (id) => {
    if (!confirm("Libérer ce logement ?")) return;
    await updateDoc(doc(db, "apartments", id), {
        status: "Disponible", tenantUid: null, tenantEmail: null, tenantName: null, paymentStatus: null, receiptDate: null
    });
    renderMyRental();
};

window.viewReceipt = (id) => {
    const a = state.apartments.find(x => x.id === id);
    if (!a) return;
    document.getElementById('receipt-body').innerHTML = `
        <p><strong>Référence :</strong> KZ-${a.id.slice(-6)}</p>
        <p><strong>Date :</strong> ${a.receiptDate || new Date().toLocaleDateString('fr-FR')}</p>
        <p><strong>Locataire :</strong> ${a.tenantName}</p>
        <p><strong>Bailleur :</strong> ${a.ownerName}</p>
        <p><strong>Logement :</strong> ${a.title} (${a.commune})</p>
        <p style="margin-top:10px;"><strong>Montant réglé : ${a.price} $ USD</strong></p>
    `;
    document.getElementById('receipt-modal').style.display = 'flex';
};

document.getElementById('btn-close-receipt').addEventListener('click', () => {
    document.getElementById('receipt-modal').style.display = 'none';
});

// ================= MESSAGERIE =================
window.openChat = async (ownerEmail, ownerName, title) => {
    const chatId = `${state.user.email}_${ownerEmail}`.replace(/[.@]/g, '_');
    const chatRef = doc(db, "chats", chatId);
    const snap = await getDoc(chatRef);
    if (!snap.exists()) {
        await setDoc(chatRef, {
            id: chatId, tenantEmail: state.user.email, tenantName: state.user.name,
            ownerEmail, ownerName, context: title,
            messages: [{ sender: "system", text: `Discussion : ${title}`, time: "" }]
        });
    }
    state.activeChatId = chatId;
    document.getElementById('chat-room-title').innerText = ownerName;
    document.getElementById('chat-room-subtitle').innerText = title;
    showScreen('scr-chat-room');
    renderChatMessages();
};

function renderChatList(containerId) {
    const myChats = state.chats.filter(c => state.user.role === 'owner' ? c.ownerEmail === state.user.email : c.tenantEmail === state.user.email);
    const container = document.getElementById(containerId);
    if (myChats.length === 0) {
        container.innerHTML = `<p style="text-align:center; color:var(--text-sub); margin-top:32px; font-size:13px;">Aucune conversation.</p>`;
        return;
    }
    container.innerHTML = myChats.map(c => {
        const name = state.user.role === 'owner' ? c.tenantName : c.ownerName;
        return `
        <div class="card form-card" style="cursor:pointer; margin-bottom:10px;" onclick="window.enterRoom('${c.id}', '${name}', '${c.context}')">
            <h4 style="font-size:14px;">${name}</h4>
            <span style="font-size:12px; color:var(--text-sub);">${c.context}</span>
        </div>`;
    }).join('');
}

window.enterRoom = (id, name, context) => {
    state.activeChatId = id;
    document.getElementById('chat-room-title').innerText = name;
    document.getElementById('chat-room-subtitle').innerText = context;
    showScreen('scr-chat-room');
    renderChatMessages();
};

function renderChatMessages() {
    const chat = state.chats.find(c => c.id === state.activeChatId);
    if (!chat) return;
    const box = document.getElementById('chat-messages-container');
    box.innerHTML = chat.messages.map(m => {
        if (m.sender === 'system') return `<div style="text-align:center; font-size:11px; color:var(--text-sub);">${m.text}</div>`;
        const isMe = m.sender === state.user.email;
        return `<div class="bubble ${isMe ? 'bubble-me' : 'bubble-other'}">${m.text}</div>`;
    }).join('');
    box.scrollTop = box.scrollHeight;
}

document.getElementById('btn-send-msg').addEventListener('click', async () => {
    const input = document.getElementById('chat-input-field');
    const txt = input.value.trim();
    if (!txt || !state.activeChatId) return;
    input.value = "";
    await updateDoc(doc(db, "chats", state.activeChatId), {
        messages: arrayUnion({ sender: state.user.email, text: txt, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })
    });
});

document.getElementById('btn-close-chat').addEventListener('click', () => {
    state.activeChatId = null;
    showScreen(state.user.role === 'owner' ? 'scr-owner' : 'scr-tenant');
});
