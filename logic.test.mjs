import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, isValidPhone, matchesFilters, ratesText, waHref, receiptNo } from '../js/core/format.js';
const apt = { id: 'a1', title: 'Studio', commune: 'Gombe', reference: 'Av. X', type: 'Studio', snel: 'Cash Power', water: 'Regideso', status: 'Disponible', rates: { hour: 0, day: 30, week: 0, month: 350 } };
test('téléphone', () => {
  assert.equal(normalizePhone('+243 81 000 0000'), '243810000000');
  assert.equal(normalizePhone('0810000000'), '243810000000');
  assert.equal(normalizePhone('00243810000000'), '243810000000');
  assert.ok(isValidPhone('+243810000000')); assert.ok(!isValidPhone('12'));
  assert.ok(waHref('0810000000', 'é &').startsWith('https://wa.me/243810000000?text='));
});
test('filtres', () => {
  assert.ok(matchesFilters(apt, { q: 'gombe' }));
  assert.ok(!matchesFilters({ ...apt, status: 'Réservé' }, {}));
  assert.ok(!matchesFilters(apt, { rateType: 'hour' }));
  assert.ok(matchesFilters(apt, { rateType: 'day', maxPrice: 30 }));
  assert.ok(!matchesFilters(apt, { maxPrice: 20 }));
  assert.ok(matchesFilters(apt, { snel: 'Cash Power', water: 'Regideso', type: 'Studio', commune: 'Gombe' }));
  assert.ok(!matchesFilters(apt, { snel: 'Forfait' }));
});
test('tarifs', () => assert.equal(ratesText(apt), '30 $ / jour • 350 $ / mois'));

test('quittance', () => assert.equal(receiptNo({ period: '2026-11', id: 'abcdefghij' }), 'KZ-202611-FGHIJ'));

test('filtres électricité/eau (anciennes annonces)', () => {
  const old = { ...apt, snel: 'Groupe/Solaire', water: 'Forage/Citerne' };
  assert.ok(matchesFilters(old, { snel: 'Solaire', water: 'Citerne' }));
  assert.ok(!matchesFilters(apt, { snel: 'Solaire' }));
  assert.ok(matchesFilters({ ...apt, snel: 'Solaire' }, { snel: 'Solaire' }));
});
