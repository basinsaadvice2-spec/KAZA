import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { advertiserOf, matchesFilters, propertyNumberLabel } from '../format.js';
import { matchesSavedSearch } from '../functions/criteria.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const availableApartment = {
  id: 'listing-1',
  status: 'Disponible',
  title: 'Appartement calme',
  commune: 'Gombe',
  reference: 'Avenue des Cliniques',
  type: 'Appartement',
  unitNumber: 'B12',
  buildingName: 'Résidence Kasaï',
  rates: { month: 350 },
  snel: 'Solaire',
  water: 'Forage'
};

test('search matches the unit number and respects every active filter', () => {
  const filters = {
    q: 'b12', commune: 'Gombe', maxPrice: 400, rateType: 'month',
    snel: 'Solaire', water: 'Forage', type: 'Appartement'
  };
  assert.equal(matchesFilters(availableApartment, filters), true);
  assert.equal(matchesFilters(availableApartment, { q: 'AVENUE DES CLINIQUES' }), true);
  assert.equal(matchesFilters(availableApartment, { q: 'résidence kasaï' }), true);
  assert.equal(matchesFilters(availableApartment, { q: 'adresse inconnue' }), false);
  assert.equal(matchesFilters(availableApartment, { ...filters, maxPrice: 300 }), false);
  assert.equal(matchesFilters({ ...availableApartment, status: 'Loué' }, filters), false);
});

test('saved searches match the same unit and legacy utility labels', () => {
  assert.equal(matchesSavedSearch(availableApartment, {
    q: 'résidence kasaï', commune: 'Gombe', maxPrice: 400, rateType: 'month',
    snel: 'Solaire', water: 'Forage', type: 'Appartement'
  }), true);
  assert.equal(matchesSavedSearch({ ...availableApartment, water: 'Forage/Citerne' }, { water: 'Forage' }), true);
});

test('property numbers and advertiser details stay compatible with older listings', () => {
  assert.equal(propertyNumberLabel(availableApartment), 'Appartement B12');
  assert.equal(propertyNumberLabel({ propertyNumber: '24B' }), 'N° 24B');
  assert.deepEqual(advertiserOf({}, { name: 'Agence Kasaï', phone: '+243810000000', accountType: 'agency' }), {
    name: 'Agence Kasaï', type: 'Agence immobilière', phone: '+243810000000'
  });
  assert.equal(advertiserOf({ ownerName: 'Patrick' }).name, 'Patrick');
  assert.equal(advertiserOf({}).name, 'Nom non renseigné');
});

test('PWA shell contains every local resource and metadata JSON parses', () => {
  const worker = readFileSync(join(root, 'sw.js'), 'utf8');
  const shellText = worker.match(/const APP_SHELL = \[([\s\S]*?)\];/)?.[1];
  assert.ok(shellText, 'service worker cache list should exist');
  for (const [, path] of shellText.matchAll(/'([^']+)'/g)) {
    assert.ok(existsSync(join(root, path.slice(1))), `cached resource ${path} should exist`);
  }
  for (const path of ['manifest.webmanifest', 'firebase.json', '.firebaserc', 'firestore.indexes.json', 'vercel.json', 'android/twa/twa-config.json', 'android/twa/assetlinks.json.example']) {
    assert.doesNotThrow(() => JSON.parse(readFileSync(join(root, path), 'utf8')), `${path} should be valid JSON`);
  }
});

test('static HTML has unique IDs and loads the standalone PWA bootstrap', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, new Set(ids).size, 'HTML IDs should be unique');
  assert.match(html, /<script type="module" src="pwa\.js"><\/script>\s*<script type="module" src="main\.js"><\/script>/);
});

test('install action is grouped with role choices and publish reports errors while requiring photos', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const roleScreen = html.split('id="scr-role-select"')[1].split('</section>')[0];
  const publish = readFileSync(join(root, 'publish.js'), 'utf8');
  const styles = readFileSync(join(root, 'style.css'), 'utf8');

  assert.equal((html.match(/id="pwa-install-button"/g) || []).length, 1);
  assert.ok(roleScreen.indexOf('Espace Bailleur') < roleScreen.indexOf('id="pwa-install-button"'));
  assert.match(styles, /\.form-input-container\.no-label\s*>\s*i\s*\{\s*top:\s*50%;/);
  assert.match(publish, /Ajoutez au moins une photo pour publier/);
  assert.match(publish, /setPublishFeedback\(visibleError\.message\)/);
  assert.match(publish, /photoUrl:\s*photos\[0\]/);
  assert.match(html, /Photos obligatoires/);
});
