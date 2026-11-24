export function matchesSavedSearch(apartment, search) {
  if (apartment.status !== 'Disponible') return false;
  if (search.commune && apartment.commune !== search.commune) return false;
  if (search.type && apartment.type !== search.type) return false;
  const legacy = {
    'Groupe électrogène': 'Groupe/Solaire',
    Solaire: 'Groupe/Solaire',
    Forage: 'Forage/Citerne',
    Citerne: 'Forage/Citerne'
  };
  if (search.snel && apartment.snel !== search.snel && apartment.snel !== legacy[search.snel]) return false;
  if (search.water && apartment.water !== search.water && apartment.water !== legacy[search.water]) return false;
  const rates = apartment.rates || { month: Number(apartment.price) || 0 };
  if (search.rateType && !(Number(rates[search.rateType]) > 0)) return false;
  if (Number(search.maxPrice) > 0) {
    const prices = search.rateType ? [rates[search.rateType]] : Object.values(rates);
    if (!prices.some((price) => Number(price) > 0 && Number(price) <= Number(search.maxPrice))) return false;
  }
  const query = String(search.q || '').trim().toLocaleLowerCase();
  if (query) {
    const haystack = `${apartment.title || ''} ${apartment.commune || ''} ${apartment.reference || ''} ${apartment.id || ''} ${apartment.propertyNumber || ''} ${apartment.unitNumber || ''} ${apartment.buildingName || ''}`.toLocaleLowerCase();
    if (!haystack.includes(query)) return false;
  }
  return true;
}
