// Fonctions pures (testables sans navigateur)
export const RATE_LABELS = { hour: 'heure', day: 'jour', week: 'semaine', month: 'mois' };
export const ratesOf = (a) => a.rates || { month: a.price || 0 };
export const ratesText = (a) => Object.entries(ratesOf(a)).filter(([, v]) => v > 0).map(([k, v]) => `${v} $ / ${RATE_LABELS[k] || k}`).join(' • ');
export const photosOf = (a) => (a.photos && a.photos.length) ? a.photos : (a.photoUrl ? [a.photoUrl] : []);
const LEGACY_AVAILABILITY = new Set(['Disponible', 'Réservé', 'Loué']);
export const availabilityStatusOf = (a) => a?.availabilityStatus || (LEGACY_AVAILABILITY.has(a?.status) ? a.status : '');
const SAFE_IMAGE_DATA_URL = /^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/i;
export const safeUrl = (u) => /^https?:\/\//i.test(u || '') || SAFE_IMAGE_DATA_URL.test(u || '') ? u : '';
export function advertiserOf(apartment, profile = null) {
  const name = String(profile?.name || apartment.ownerName || '').trim();
  return {
    name: name || 'Nom non renseigné',
    type: profile?.accountType === 'agency' || apartment.ownerType === 'agency' ? 'Agence immobilière' : 'Bailleur',
    phone: profile?.phone || apartment.ownerPhone || ''
  };
}
export function propertyNumberLabel(apartment) {
  if (apartment.unitNumber) return `Appartement ${apartment.unitNumber}`;
  if (apartment.propertyNumber) return `N° ${apartment.propertyNumber}`;
  return '';
}

export function normalizePhone(raw) {
  let d = String(raw || '').trim();
  const intl = d.startsWith('+') || d.startsWith('00');
  d = d.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (!intl && d.startsWith('0')) d = '243' + d.slice(1);
  else if (!intl && /^[89]\d{8}$/.test(d)) d = '243' + d;
  return d;
}
export const isValidPhone = (raw) => /^\d{11,15}$/.test(normalizePhone(raw));
export const telHref = (raw) => `tel:+${normalizePhone(raw)}`;
export const waHref = (raw, msg) => `https://wa.me/${normalizePhone(raw)}?text=${encodeURIComponent(msg)}`;
export const inquiryMessage = (a) => `Bonjour ${a.ownerName || ''}, je suis intéressé(e) par « ${a.title} » (${a.commune}, ${a.reference}) — ${ratesText(a)}. Réf. ${a.id}. Message envoyé depuis Kaza.`;

export function matchesFilters(a, f) {
  const availability = availabilityStatusOf(a);
  const isPublic = a.status === 'publie';
  if (!isPublic || availability !== 'Disponible') return false;
  const query = String(f.q || '').trim().toLowerCase();
  if (f.commune && a.commune !== f.commune) return false;
  if (f.type && a.type !== f.type) return false;
  const legacy = { 'Groupe électrogène': 'Groupe/Solaire', 'Solaire': 'Groupe/Solaire', 'Forage': 'Forage/Citerne', 'Citerne': 'Forage/Citerne' };
  if (f.snel && a.snel !== f.snel && a.snel !== legacy[f.snel]) return false;
  if (f.water && a.water !== f.water && a.water !== legacy[f.water]) return false;
  const rates = ratesOf(a);
  if (f.rateType && !(rates[f.rateType] > 0)) return false;
  if (f.maxPrice > 0) {
    const pool = f.rateType ? [rates[f.rateType]] : Object.values(rates);
    if (!pool.some(v => v > 0 && v <= f.maxPrice)) return false;
  }
  if (query && !`${a.title} ${a.commune} ${a.reference} ${a.id} ${a.propertyNumber || ''} ${a.unitNumber || ''} ${a.buildingName || ''}`.toLowerCase().includes(query)) return false;
  return true;
}

export const receiptNo = (p) => `KZ-${String(p.period || '').replace('-', '')}-${String(p.id || '').slice(-5).toUpperCase()}`;
export const fmtDate = (ts) => ts && ts.toDate ? ts.toDate().toLocaleDateString('fr-FR') : '';
