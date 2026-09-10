// js/dom-utils.js
// Petits utilitaires pour construire le DOM sans jamais injecter de
// texte utilisateur via innerHTML — c'était la principale faille XSS
// de l'ancienne version (titres, messages de chat, noms... étaient
// concaténés tels quels dans du HTML).
//
// Règle : le HTML "de mise en page" (structure fixe, écrite par nous)
// peut utiliser innerHTML. Toute donnée qui vient d'un utilisateur
// (titre de bien, message de chat, nom, email...) doit passer par
// el() / text() ci-dessous, qui utilisent textContent en interne.

export function el(tag, { className, attrs, text, html, children, on } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value !== null && value !== undefined) node.setAttribute(key, value);
    }
  }
  // `text` est toujours sûr (textContent). `html` ne doit servir que
  // pour des fragments statiques écrits par nous (icônes FontAwesome…),
  // jamais pour du contenu utilisateur.
  if (text !== undefined) node.textContent = text;
  if (html !== undefined) node.innerHTML = html;
  if (children) {
    children.forEach((child) => {
      if (child) node.appendChild(child);
    });
  }
  if (on) {
    for (const [event, handler] of Object.entries(on)) {
      node.addEventListener(event, handler);
    }
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function iconEl(faClass, extraStyle) {
  const i = document.createElement("i");
  i.className = faClass;
  if (extraStyle) i.setAttribute("style", extraStyle);
  return i;
}

// Échappement défensif pour les rares cas où un attribut doit être
// injecté dans une chaîne de gabarit (préférez toujours el()/text()).
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
