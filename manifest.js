'use strict';
const PAGE_SIZE = 1000; // whole list in one response; no paging

// key = which list from the scraper feeds the catalog
const CATALOGS = [
  { id: 'rmz-latest-episodes', key: 'all', name: 'Calendar Episodes' },
  { id: 'rmz-new-series', key: 'new', name: 'Yeni Diziler' },
  { id: 'rmz-returning-series', key: 'returning', name: 'Geri Dönen Diziler' },
  { id: 'rmz-ongoing-series', key: 'ongoing', name: 'Devam Eden Diziler' },
];
const CATALOG_ID = CATALOGS[0].id;

const manifest = {
  id: 'community.rmz.latestepisodes',
  version: '1.4.1',
  name: 'Calendar Episodes',
  description: 'Shows with the newest episodes listed on rmz.cr, refreshed hourly.',
  resources: ['catalog'],
  types: ['series'],
  catalogs: CATALOGS.map((c) => ({ type: 'series', id: c.id, name: c.name })),
  idPrefixes: ['tt'],
  behaviorHints: { configurable: false },
};

// Adds a genre picker to every catalog, listing the genres present in the data.
function withGenres(lists) {
  const count = new Map();
  for (const meta of lists.all || []) for (const g of meta.genres || []) count.set(g, (count.get(g) || 0) + 1);
  const options = [...count.keys()].sort((a, b) => a.localeCompare(b));
  return {
    ...manifest,
    catalogs: manifest.catalogs.map((c) => ({ ...c, extra: [{ name: 'genre', options, isRequired: false }] })),
  };
}

const byGenre = (items, genre) => (genre ? items.filter((m) => (m.genres || []).includes(genre)) : items);

module.exports = { manifest, CATALOGS, CATALOG_ID, PAGE_SIZE, withGenres, byGenre };
