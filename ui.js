// js/ui.js
// Toute l'interface est reconstruite avec des gestionnaires d'événements
// JS (addEventListener), plus aucun `onclick="..."` inline dans le HTML.
// Deux raisons :
//  1. Sécurité DOM : le contenu dynamique (titres de biens, noms,
//     messages de chat) est injecté via textContent (voir dom-utils.js),
//     jamais concaténé dans une chaîne HTML — ça élimine la faille XSS
//     de l'ancienne version où item.title, item.specs, m.text, etc.
//     étaient insérés tels quels dans innerHTML.
//  2. Ça permet d'activer une Content-Security-Policy stricte plus tard
//     (script-src 'self', sans 'unsafe-inline') sans rien casser.

import { el, clear, iconEl } from "./dom-utils.js";
import { state } from "./state.js";
import { registerUser, loginUser, logoutUser, watchAuthState } from "./auth.js";
import {
  watchOwnerApartments,
  watchCatalog,
  filterCatalog,
  createApartment,
  deleteApartment,
} from "./apartments.js";
import { rentApartment, leaveApartment } from "./leases.js";
import { notifyPayment, confirmTenantPayment } from "./payments.js";
import { authorizeTenantEmail } from "./authorizations.js";
import {
  getOrCreateChat,
  sendMessage,
  watchMyChats,
  watchMessages,
  broadcastToAllTenants,
} from "./chat.js";
import { getEndedLeasesToRate, submitRating, RATING_CRITERIA } from "./ratings.js";
import { requestNotificationPermission } from "./notifications.js";

let unsubApartments = null;
let unsubChats = null;

// ---------------------------------------------------------------------
// Routage
// ---------------------------------------------------------------------
export function changeView(screenId) {
  document
    .querySelectorAll(".screen-view")
    .forEach((v) => v.classList.remove("active"));
  document.getElementById(screenId).classList.add("active");
}

function showError(err) {
  const message = err?.message || "Une erreur est survenue.";
  alert(message);
  console.error(err);
}

// ---------------------------------------------------------------------
// Écran d'accueil / authentification
// ---------------------------------------------------------------------
export function initRoleSelection() {
  document
    .getElementById("role-card-owner")
    .addEventListener("click", () => openAuthScreen("owner"));
  document
    .getElementById("role-card-tenant")
    .addEventListener("click", () => openAuthScreen("tenant"));
}

function openAuthScreen(role) {
  state.pendingRole = role;
  state.authMode = "login";
  document.getElementById("container-auth-name").style.display = "none";
  document.getElementById("container-auth-phone").style.display = "none";
  document.getElementById("auth-title").textContent =
    "Connexion " + (role === "owner" ? "Bailleur" : "Locataire");
  document.getElementById("auth-subtitle").textContent =
    "Entrez vos accès pour piloter votre espace KAZA.";
  document.getElementById("btn-auth-submit").className =
    "btn-submit-form " + (role === "owner" ? "owner-theme" : "tenant-theme");
  document.getElementById("auth-toggle-mode-link").textContent =
    "Pas encore de compte ? S'inscrire";
  document.getElementById("auth-name").value = "";
  document.getElementById("auth-email").value = "";
  document.getElementById("auth-phone").value = "";
  document.getElementById("auth-password").value = "";
  changeView("scr-auth");
}

function toggleAuthMode() {
  const isLogin = state.authMode === "login";
  state.authMode = isLogin ? "register" : "login";
  const roleLabel = state.pendingRole === "owner" ? "Bailleur" : "Locataire";
  document.getElementById("auth-title").textContent =
    (isLogin ? "Inscription " : "Connexion ") + roleLabel;
  document.getElementById("container-auth-name").style.display = isLogin
    ? "block"
    : "none";
  document.getElementById("container-auth-phone").style.display = isLogin
    ? "block"
    : "none";
  document.getElementById("auth-toggle-mode-link").textContent = isLogin
    ? "Déjà inscrit ? Se connecter"
    : "Pas encore de compte ? S'inscrire";
}

async function submitAuthForm() {
  const name = document.getElementById("auth-name").value.trim();
  const email = document.getElementById("auth-email").value.trim().toLowerCase();
  const phone = document.getElementById("auth-phone").value.trim();
  const password = document.getElementById("auth-password").value;

  if (!email || !password) {
    alert("Veuillez saisir votre email et votre mot de passe.");
    return;
  }
  if (password.length < 6) {
    alert("Le mot de passe doit contenir au moins 6 caractères.");
    return;
  }

  const submitBtn = document.getElementById("btn-auth-submit");
  submitBtn.disabled = true;
  submitBtn.textContent = "Veuillez patienter…";

  try {
    if (state.authMode === "register") {
      // watchAuthState() ignore volontairement les événements pendant
      // l'inscription (voir auth.js) : on bascule donc l'écran nous-
      // mêmes dès que la promesse est résolue.
      const profile = await registerUser({ role: state.pendingRole, name, email, phone, password });
      enterAppForUser(profile);
    } else {
      // Pour la connexion, watchAuthState() (dans app.js) détecte le
      // changement de session et bascule l'écran automatiquement.
      await loginUser({ email, password });
    }
  } catch (err) {
    showError(err);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Continuer";
  }
}

export function initAuthScreen() {
  document
    .getElementById("btn-back-role")
    .addEventListener("click", () => changeView("scr-role-select"));
  document
    .getElementById("btn-auth-submit")
    .addEventListener("click", submitAuthForm);
  document
    .getElementById("auth-toggle-mode-link")
    .addEventListener("click", toggleAuthMode);
}

// ---------------------------------------------------------------------
// Bascule après connexion réussie
// ---------------------------------------------------------------------
export function enterAppForUser(profile) {
  if (unsubApartments) unsubApartments();
  if (unsubChats) unsubChats();

  if (profile.role === "owner") {
    document.getElementById("owner-profile-display").textContent = profile.name;
    changeView("scr-owner-dashboard");
    activateOwnerTab("home");
  } else {
    document.getElementById("tenant-profile-display").textContent = profile.name;
    changeView("scr-tenant-dashboard");
    activateTenantTab("discover");
  }
  requestNotificationPermission().catch(() => {});
}

export function exitAppToRoleSelect() {
  if (unsubApartments) unsubApartments();
  if (unsubChats) unsubChats();
  changeView("scr-role-select");
}

// ---------------------------------------------------------------------
// Tableau de bord Bailleur
// ---------------------------------------------------------------------
export function initOwnerDashboard() {
  document
    .getElementById("nav-tab-owner-home")
    .addEventListener("click", () => activateOwnerTab("home"));
  document
    .getElementById("nav-tab-owner-apparts")
    .addEventListener("click", () => activateOwnerTab("apparts"));
  document
    .getElementById("nav-tab-owner-chats")
    .addEventListener("click", () => activateOwnerTab("chats"));
  document
    .querySelectorAll('#scr-owner-dashboard [data-action="theme"]')
    .forEach((b) => b.addEventListener("click", toggleAppTheme));
  document
    .querySelectorAll('#scr-owner-dashboard [data-action="logout"]')
    .forEach((b) => b.addEventListener("click", () => logoutUser()));
}

function activateOwnerTab(tabName) {
  document
    .querySelectorAll("#scr-owner-dashboard .tab-navigation-item")
    .forEach((t) => t.classList.remove("active"));
  document.getElementById(`nav-tab-owner-${tabName}`).classList.add("active");

  const container = document.getElementById("owner-tab-injector");
  clear(container);

  if (unsubApartments) unsubApartments();
  unsubApartments = watchOwnerApartments(state.currentUser.uid, (apartments) => {
    state.apartments = apartments;
    if (tabName === "home") renderOwnerHome(container, apartments);
    if (tabName === "apparts") renderOwnerApartments(container, apartments);
  });

  if (tabName === "chats") {
    renderChatList(container);
  }
}

async function renderOwnerHome(container, apartments) {
  clear(container);

  const statsRow = el("div", { className: "stats-grid-row" });
  statsRow.appendChild(
    kpiCard("fa-solid fa-building", "Vos Biens", apartments.length, "blue-indicator")
  );
  statsRow.appendChild(
    kpiCard(
      "fa-solid fa-user-check",
      "Actifs",
      apartments.filter((a) => a.status === "Occupé").length,
      "green-indicator"
    )
  );
  container.appendChild(statsRow);

  const revenueTotal = apartments.reduce(
    (acc, curr) => acc + (curr.status === "Occupé" ? Number(curr.price || 0) : 0),
    0
  );
  container.appendChild(
    el("div", {
      className: "revenue-box",
      children: [
        el("div", {
          children: [
            el("h4", { text: "Revenus Estimés" }),
            el("p", { text: "Cumul de vos loyers occupés" }),
          ],
        }),
        el("strong", { text: `${revenueTotal} $` }),
      ],
    })
  );

  // Autoriser un locataire
  const authBox = el("div", { className: "surface-box" });
  authBox.appendChild(
    el("h4", {
      children: [
        iconEl("fa-solid fa-user-shield", "color:var(--primary)"),
        document.createTextNode(" Autoriser un locataire"),
      ],
    })
  );
  authBox.appendChild(
    el("p", {
      className: "muted-text",
      text: "Inscrivez l'email de votre locataire pour lui permettre de s'inscrire sur KAZA.",
    })
  );
  const emailInput = el("input", {
    attrs: { type: "email", placeholder: "Ex: locataire@gmail.com" },
  });
  const authRow = el("div", {
    className: "inline-form-row",
    children: [
      emailInput,
      el("button", {
        className: "btn-action-trigger",
        children: [iconEl("fa-solid fa-plus")],
        on: {
          click: async () => {
            try {
              const email = await authorizeTenantEmail(emailInput.value);
              alert(`✅ Succès : le locataire [ ${email} ] peut désormais s'inscrire.`);
              emailInput.value = "";
            } catch (err) {
              showError(err);
            }
          },
        },
      }),
    ],
  });
  authBox.appendChild(authRow);
  container.appendChild(authBox);

  // Paiements en attente de confirmation
  apartments
    .filter((ap) => ap.paymentStatus === "signale")
    .forEach((ap) => {
      container.appendChild(
        el("div", {
          className: "pending-payment-box",
          children: [
            el("span", {
              children: [
                el("strong", { text: ap.tenantName || "Locataire" }),
                document.createTextNode(" signale avoir payé pour : "),
                el("br"),
                el("em", { text: ap.title }),
              ],
            }),
            el("button", {
              className: "btn-action-trigger confirm-btn",
              text: "Confirmer",
              on: {
                click: async (e) => {
                  e.target.disabled = true;
                  try {
                    await confirmTenantPayment(ap);
                    alert("Paiement validé. Reçu transmis au locataire.");
                  } catch (err) {
                    showError(err);
                  } finally {
                    e.target.disabled = false;
                  }
                },
              },
            }),
          ],
        })
      );
    });

  // Locataires en attente d'évaluation
  const toRate = await getEndedLeasesToRate(state.currentUser.uid).catch(() => []);
  if (toRate.length > 0) {
    const ratingBox = el("div", { className: "surface-box" });
    ratingBox.appendChild(
      el("h4", {
        children: [
          iconEl("fa-solid fa-star", "color:var(--primary)"),
          document.createTextNode(" Locataires à évaluer"),
        ],
      })
    );
    toRate.forEach((lease) => {
      ratingBox.appendChild(
        el("div", {
          className: "inline-form-row",
          children: [
            el("span", { text: lease.tenantName || "Locataire" }),
            el("button", {
              className: "btn-action-trigger",
              text: "Évaluer",
              on: { click: () => openRatingModal(lease) },
            }),
          ],
        })
      );
    });
    container.appendChild(ratingBox);
  }
}

function kpiCard(iconClass, label, value, colorClass) {
  return el("div", {
    className: `stats-kpi-card ${colorClass}`,
    children: [
      el("div", {
        className: "stats-kpi-header",
        children: [iconEl(iconClass), document.createTextNode(" " + label)],
      }),
      el("div", { className: "stats-kpi-number", text: String(value) }),
    ],
  });
}

function renderOwnerApartments(container, apartments) {
  clear(container);
  container.appendChild(
    el("div", {
      className: "action-context-bar",
      children: [
        el("span", { className: "context-title", text: "Vos Annonces" }),
        el("button", {
          className: "btn-action-trigger",
          children: [iconEl("fa-solid fa-plus"), document.createTextNode(" Ajouter")],
          on: { click: () => changeView("scr-add-appart") },
        }),
      ],
    })
  );

  if (apartments.length === 0) {
    container.appendChild(blankSlate("fa-solid fa-folder-open", "Aucun bien publié."));
    return;
  }

  apartments.forEach((item) => {
    container.appendChild(buildApartmentCard(item, { mode: "owner" }));
  });
}

function blankSlate(iconClass, text) {
  return el("div", {
    className: "blank-slate",
    children: [iconEl(iconClass), el("span", { text })],
  });
}

function fullAddress(item) {
  let addr = `Av. ${item.avenue}, N° ${item.streetNumber}`;
  if (item.door) addr += `, Apt/Porte ${item.door}`;
  return addr;
}

function buildApartmentCard(item, { mode }) {
  const card = el("div", { className: "apartment-card-ui" });

  const imagePlaceholder = el("div", { className: "apartment-card-image-placeholder" });
  const coverImg = item.imageUrl
    ? el("img", { attrs: { id: `cover-${item.id}`, src: item.imageUrl, alt: item.title } })
    : iconEl("fa-solid fa-image");
  imagePlaceholder.appendChild(coverImg);
  imagePlaceholder.appendChild(
    el("span", {
      className: "apartment-card-badge",
      attrs: {
        style: `background:${item.status === "Occupé" ? "#e74c3c" : "var(--primary)"}`,
      },
      text: item.status || "Disponible",
    })
  );
  card.appendChild(imagePlaceholder);

  if (Array.isArray(item.images) && item.images.length > 0) {
    const gallery = el("div", { className: "gallery-miniatures" });
    item.images.forEach((imgUrl) => {
      if (!imgUrl) return;
      gallery.appendChild(
        el("img", {
          attrs: { src: imgUrl, alt: "" },
          on: {
            click: (e) => {
              e.stopPropagation();
              const target = coverImg;
              if (target.tagName === "IMG") target.src = imgUrl;
            },
          },
        })
      );
    });
    card.appendChild(gallery);
  }

  const details = el("div", { className: "apartment-card-details" });
  details.appendChild(
    el("span", {
      className: "apartment-card-location",
      text: `${item.commune}, Kinshasa${mode === "tenant" ? " • Par " + item.ownerName : ""}`,
    })
  );
  details.appendChild(
    el("h4", {
      className: "apartment-card-title",
      text: mode === "owner" ? `${item.title} (${item.type})` : item.title,
    })
  );
  details.appendChild(
    el("p", {
      className: "apartment-card-address-detail",
      children: [
        iconEl("fa-solid fa-location-dot", "color:var(--primary)"),
        document.createTextNode(" " + fullAddress(item)),
        el("br"),
        el("small", { text: `Réf: ${item.reference}` }),
      ],
    })
  );

  if (mode === "owner") {
    details.appendChild(
      el("div", {
        className: "apartment-card-pricing-row",
        children: [
          el("span", {
            className: "apartment-card-price",
            children: [
              document.createTextNode(`${item.price} $ `),
              el("small", { text: "/mois" }),
            ],
          }),
          el("span", { className: "muted-strong", text: item.specs }),
        ],
      })
    );
    details.appendChild(
      el("button", {
        className: "btn-action-trigger danger-btn",
        children: [
          iconEl("fa-solid fa-trash-can"),
          document.createTextNode(" Supprimer ce bien définitivement"),
        ],
        on: {
          click: async (e) => {
            e.stopPropagation();
            if (!confirm("⚠️ Supprimer définitivement ce logement ?")) return;
            try {
              await deleteApartment(item.id);
            } catch (err) {
              showError(err);
            }
          },
        },
      })
    );
  } else {
    details.appendChild(buildTenantActionsRow(item));
    details.appendChild(
      el("div", {
        className: "apartment-card-pricing-row",
        children: [
          el("span", {
            className: "apartment-card-price",
            children: [
              document.createTextNode(`${item.price} $ `),
              el("small", { text: "/mois" }),
            ],
          }),
          el("span", {
            className: "chat-hint",
            children: [
              iconEl("fa-solid fa-comments"),
              document.createTextNode(" Chat Privé"),
            ],
          }),
        ],
      })
    );
    card.addEventListener("click", () =>
      startPrivateChat({ ownerId: item.ownerId, ownerName: item.ownerName, apartmentId: item.id, apartmentTitle: item.title })
    );
  }

  card.appendChild(details);
  return card;
}

function buildTenantActionsRow(item) {
  const row = el("div", { className: "tenant-actions-row" });
  const isMyLease = item.tenantId === state.currentUser.uid;
  const isOccupied = item.status === "Occupé";

  if (!isOccupied) {
    row.appendChild(
      el("button", {
        className: "btn-action-trigger tenant-cta",
        children: [iconEl("fa-solid fa-key"), document.createTextNode(" Louer la résidence")],
        on: {
          click: async (e) => {
            e.stopPropagation();
            try {
              await rentApartment(item.id);
              alert("Votre demande de location a été transmise au propriétaire.");
            } catch (err) {
              showError(err);
            }
          },
        },
      })
    );
  } else if (isMyLease) {
    row.appendChild(
      el("button", {
        className: "btn-action-trigger danger-btn small-btn",
        children: [iconEl("fa-solid fa-door-open"), document.createTextNode(" Partir de la résidence")],
        on: {
          click: async (e) => {
            e.stopPropagation();
            if (!confirm("Signaler votre départ de ce logement ?")) return;
            try {
              await leaveApartment(item.id);
              alert("Notification de départ envoyée avec succès.");
            } catch (err) {
              showError(err);
            }
          },
        },
      })
    );
    if (item.paymentStatus === "signale") {
      row.appendChild(
        el("span", {
          className: "status-pill declared",
          children: [iconEl("fa-solid fa-circle-check"), document.createTextNode(" Paiement déclaré (non vérifié)")],
        })
      );
    } else if (item.paymentStatus === "confirme") {
      row.appendChild(
        el("span", {
          className: "status-pill confirmed",
          children: [iconEl("fa-solid fa-handshake"), document.createTextNode(" Loyer confirmé par le bailleur")],
        })
      );
    } else {
      row.appendChild(
        el("button", {
          className: "btn-action-trigger warn-btn small-btn",
          children: [
            iconEl("fa-solid fa-money-bill-wave"),
            document.createTextNode(" Signaler Loyer Payé"),
          ],
          on: {
            click: async (e) => {
              e.stopPropagation();
              try {
                await notifyPayment(item);
                alert(
                  "Déclaration envoyée au bailleur. Ceci n'est pas une preuve de paiement automatique : le bailleur doit confirmer avoir réellement reçu les fonds."
                );
              } catch (err) {
                showError(err);
              }
            },
          },
        })
      );
    }
  } else {
    row.appendChild(
      el("span", { className: "apartment-card-badge static-badge", text: "Occupé" })
    );
  }
  return row;
}

// ---------------------------------------------------------------------
// Ajouter un bien
// ---------------------------------------------------------------------
export function initAddApartmentScreen() {
  document.getElementById("btn-back-add-appart").addEventListener("click", () => {
    changeView("scr-owner-dashboard");
    activateOwnerTab("apparts");
  });
  document.getElementById("app-type").addEventListener("change", (e) => {
    const doorField = document.getElementById("container-app-door");
    if (e.target.value === "Maison") {
      doorField.style.display = "none";
      document.getElementById("app-door").value = "";
    } else {
      doorField.style.display = "block";
    }
  });
  document.getElementById("btn-save-apartment").addEventListener("click", async () => {
    const form = {
      title: document.getElementById("app-title").value,
      type: document.getElementById("app-type").value,
      commune: document.getElementById("app-commune").value,
      avenue: document.getElementById("app-avenue").value,
      streetNumber: document.getElementById("app-street-number").value,
      door: document.getElementById("app-door").value,
      reference: document.getElementById("app-reference").value,
      price: document.getElementById("app-price").value,
      specs: document.getElementById("app-specs").value,
      photo1: document.getElementById("app-photo-1").value,
      photo2: document.getElementById("app-photo-2").value,
      photo3: document.getElementById("app-photo-3").value,
      photo4: document.getElementById("app-photo-4").value,
    };
    try {
      await createApartment(form);
      [
        "app-title",
        "app-avenue",
        "app-street-number",
        "app-door",
        "app-reference",
        "app-price",
        "app-specs",
        "app-photo-1",
        "app-photo-2",
        "app-photo-3",
        "app-photo-4",
      ].forEach((id) => (document.getElementById(id).value = ""));
      changeView("scr-owner-dashboard");
      activateOwnerTab("apparts");
    } catch (err) {
      showError(err);
    }
  });
}

// ---------------------------------------------------------------------
// Tableau de bord Locataire
// ---------------------------------------------------------------------
export function initTenantDashboard() {
  document
    .getElementById("nav-tab-tenant-discover")
    .addEventListener("click", () => activateTenantTab("discover"));
  document
    .getElementById("nav-tab-tenant-chats")
    .addEventListener("click", () => activateTenantTab("chats"));
  document
    .querySelectorAll('#scr-tenant-dashboard [data-action="theme"]')
    .forEach((b) => b.addEventListener("click", toggleAppTheme));
  document
    .querySelectorAll('#scr-tenant-dashboard [data-action="logout"]')
    .forEach((b) => b.addEventListener("click", () => logoutUser()));
}

function activateTenantTab(tabName) {
  document
    .querySelectorAll("#scr-tenant-dashboard .tab-navigation-item")
    .forEach((t) => t.classList.remove("active"));
  document.getElementById(`nav-tab-tenant-${tabName}`).classList.add("active");

  const container = document.getElementById("tenant-tab-injector");
  clear(container);

  if (tabName === "discover") {
    renderTenantSearchBox(container);
    if (unsubApartments) unsubApartments();
    unsubApartments = watchCatalog((apartments) => {
      state.apartments = apartments;
      renderTenantCatalog();
    });
  } else if (tabName === "chats") {
    renderChatList(container);
  }
}

function renderTenantSearchBox(container) {
  const box = el("div", { className: "search-filter-box" });

  const searchInput = el("input", {
    attrs: { type: "text", placeholder: "Rechercher par mot-clé (ex: Résidence...)" },
  });
  searchInput.value = state.searchQuery;
  searchInput.addEventListener("input", (e) => {
    state.searchQuery = e.target.value;
    renderTenantCatalog();
  });
  box.appendChild(
    el("div", {
      className: "form-input-container",
      attrs: { style: "margin-bottom:0;" },
      children: [iconEl("fa-solid fa-magnifying-glass"), searchInput],
    })
  );

  const typeRow = el("div", { className: "filter-tags-scroll" });
  ["Tous", "Appartement", "Maison", "Studio"].forEach((type) => {
    typeRow.appendChild(filterTag(type, state.filterType === type, () => {
      state.filterType = type;
      activateTenantTab("discover");
    }));
  });
  box.appendChild(typeRow);

  const communeRow = el("div", {
    className: "filter-tags-scroll",
    attrs: { style: "margin-top:5px;" },
  });
  ["Toutes", "Gombe", "Ngaliema", "Limete"].forEach((commune) => {
    const label = commune === "Toutes" ? "Toutes Communes" : commune;
    communeRow.appendChild(
      filterTag(label, state.filterCommune === commune, () => {
        state.filterCommune = commune;
        activateTenantTab("discover");
      })
    );
  });
  box.appendChild(communeRow);

  container.appendChild(box);
  container.appendChild(el("div", { attrs: { id: "tenant-catalog-results" } }));
}

function filterTag(label, active, onClick) {
  return el("span", {
    className: "filter-tag" + (active ? " active" : ""),
    text: label,
    on: { click: onClick },
  });
}

function renderTenantCatalog() {
  const resultsBox = document.getElementById("tenant-catalog-results");
  if (!resultsBox) return;
  clear(resultsBox);

  const filtered = filterCatalog(state.apartments);
  if (filtered.length === 0) {
    resultsBox.appendChild(
      blankSlate("fa-solid fa-house-crack", "Aucun logement disponible ne correspond à vos critères.")
    );
    return;
  }
  filtered.forEach((item) => {
    resultsBox.appendChild(buildApartmentCard(item, { mode: "tenant" }));
  });
}

// ---------------------------------------------------------------------
// Messagerie
// ---------------------------------------------------------------------
async function startPrivateChat({ ownerId, ownerName, apartmentId, apartmentTitle }) {
  try {
    const chatId = await getOrCreateChat({ ownerId, ownerName, apartmentId, apartmentTitle });
    openChatRoom(chatId, { ownerName, apartmentTitle });
  } catch (err) {
    showError(err);
  }
}

function renderChatList(container) {
  clear(container);
  if (unsubChats) unsubChats();
  unsubChats = watchMyChats((chats) => {
    state.chats = chats;
    clear(container);
    if (chats.length === 0) {
      container.appendChild(blankSlate("fa-solid fa-comments", "Aucune conversation."));
      return;
    }
    container.appendChild(
      el("div", {
        className: "action-context-bar",
        children: [el("span", { className: "context-title", text: "Vos Conversations" })],
      })
    );
    chats.forEach((c) => {
      const correspondent = state.currentUser.role === "owner" ? c.tenantName : c.ownerName;
      const item = el("div", {
        className: "chat-list-item",
        children: [
          el("div", { className: "chat-avatar", text: (correspondent || "?").charAt(0) }),
          el("div", {
            className: "chat-info",
            children: [
              el("h4", { text: correspondent || "Correspondant" }),
              el("p", { className: "chat-context", text: `Objet: ${c.context || ""}` }),
            ],
          }),
          iconEl("fa-solid fa-chevron-right"),
        ],
        on: { click: () => openChatRoom(c.id, { ownerName: c.ownerName, apartmentTitle: c.context }) },
      });
      container.appendChild(item);
    });
  });
}

let unsubMessages = null;

function openChatRoom(chatId, { apartmentTitle } = {}) {
  state.activeChatId = chatId;
  document.getElementById("scr-chat-room").className =
    state.currentUser.role === "tenant" ? "screen-view tenant-theme" : "screen-view";
  document.getElementById("chat-room-subtitle").textContent =
    "Bien ciblé : " + (apartmentTitle || "");
  changeView("scr-chat-room");

  if (unsubMessages) unsubMessages();
  const container = document.getElementById("chat-messages-container");
  unsubMessages = watchMessages(chatId, (messages) => {
    renderMessages(container, messages);
  });
}

function renderMessages(container, messages) {
  clear(container);
  const correspondentNames = { owner: "", tenant: "" };
  messages.forEach((m) => {
    if (m.senderId === "system") {
      container.appendChild(
        el("div", { className: "system-message", text: m.text })
      );
      return;
    }
    const isMyMsg = m.senderId === state.currentUser.uid;
    const bubble = el("div", {
      className: `msg-bubble ${isMyMsg ? "outgoing" : "incoming"}`,
    });
    bubble.appendChild(el("span", { className: "msg-text", text: m.text }));
    if (state.currentUser.role === "owner" && !isMyMsg) {
      const shareHint = el("span", {
        className: "msg-share-hint",
        children: [
          iconEl("fa-solid fa-share-nodes"),
          document.createTextNode(" Diffuser (Style WhatsApp)"),
        ],
      });
      bubble.appendChild(shareHint);
      bubble.addEventListener("click", async () => {
        const confirmed = confirm(
          `Voulez-vous transférer ce message à la totalité de vos locataires ?\n\n"${m.text}"`
        );
        if (!confirmed) return;
        try {
          const count = await broadcastToAllTenants(m.text);
          alert(`Message transféré avec succès dans vos ${count} canaux.`);
        } catch (err) {
          showError(err);
        }
      });
    }
    const time = m.createdAt?.toDate
      ? m.createdAt.toDate().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
      : "";
    bubble.appendChild(el("span", { className: "msg-meta", text: time }));
    container.appendChild(bubble);
  });
  container.scrollTop = container.scrollHeight;
}

export function initChatRoom() {
  document.getElementById("btn-back-from-chat").addEventListener("click", () => {
    if (unsubMessages) unsubMessages();
    if (state.currentUser.role === "owner") {
      changeView("scr-owner-dashboard");
      activateOwnerTab("chats");
    } else {
      changeView("scr-tenant-dashboard");
      activateTenantTab("chats");
    }
  });
  document.getElementById("btn-send-message").addEventListener("click", submitChatMessage);
  document.getElementById("chat-input-field").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitChatMessage();
  });
}

async function submitChatMessage() {
  const input = document.getElementById("chat-input-field");
  if (!input.value.trim() || !state.activeChatId) return;
  const text = input.value;
  input.value = "";
  try {
    await sendMessage(state.activeChatId, text);
  } catch (err) {
    showError(err);
  }
}

// ---------------------------------------------------------------------
// Évaluation d'un locataire (modale simple)
// ---------------------------------------------------------------------
function openRatingModal(lease) {
  const overlay = el("div", { className: "modal-overlay" });
  const modal = el("div", { className: "modal-box" });
  modal.appendChild(el("h3", { text: `Évaluer ${lease.tenantName || "le locataire"}` }));

  const scoreInputs = {};
  RATING_CRITERIA.forEach((criterion) => {
    const select = el("select", {});
    for (let i = 1; i <= 5; i += 1) {
      select.appendChild(el("option", { attrs: { value: String(i) }, text: `${i} / 5` }));
    }
    select.value = "5";
    scoreInputs[criterion.key] = select;
    modal.appendChild(
      el("div", {
        className: "form-input-container rating-row",
        children: [el("label", { text: criterion.label }), select],
      })
    );
  });

  const commentInput = el("textarea", {
    attrs: { placeholder: "Commentaire (optionnel)", rows: "3" },
  });
  modal.appendChild(
    el("div", {
      className: "form-input-container",
      children: [el("label", { text: "Commentaire" }), commentInput],
    })
  );

  const actionsRow = el("div", { className: "modal-actions" });
  actionsRow.appendChild(
    el("button", {
      className: "btn-submit-form",
      attrs: { style: "background:var(--input-bg); color:var(--text-main);" },
      text: "Annuler",
      on: { click: () => overlay.remove() },
    })
  );
  actionsRow.appendChild(
    el("button", {
      className: "btn-submit-form owner-theme",
      text: "Envoyer l'évaluation",
      on: {
        click: async () => {
          const scores = {};
          Object.entries(scoreInputs).forEach(([key, sel]) => (scores[key] = sel.value));
          try {
            await submitRating(lease, scores, commentInput.value);
            overlay.remove();
            alert("Évaluation enregistrée.");
          } catch (err) {
            showError(err);
          }
        },
      },
    })
  );
  modal.appendChild(actionsRow);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

// ---------------------------------------------------------------------
// Thème & PWA
// ---------------------------------------------------------------------
function toggleAppTheme() {
  document.body.classList.toggle("dark-mode");
}

export function initPwaInstall() {
  const pwaBtn = document.getElementById("pwa-install-btn");
  let pwaPrompt;
  const isIos = () => /iPhone|iPad|iPod/i.test(navigator.userAgent);

  window.addEventListener("load", () => {
    if (isIos() && pwaBtn) pwaBtn.style.display = "block";
  });
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    pwaPrompt = e;
    if (pwaBtn) pwaBtn.style.display = "block";
  });
  if (pwaBtn) {
    pwaBtn.addEventListener("click", async () => {
      if (isIos()) {
        alert(
          "Pour installer KAZA sur iPhone :\n\n1. Cliquez sur le bouton 'Partager' en bas sur Safari.\n2. Sélectionnez 'Sur l'écran d'accueil'."
        );
      } else if (pwaPrompt) {
        pwaPrompt.prompt();
        const { outcome } = await pwaPrompt.userChoice;
        if (outcome === "accepted") pwaBtn.style.display = "none";
        pwaPrompt = null;
      }
    });
  }
}