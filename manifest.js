'use strict';
const PAGE_SIZE = 100;

// key = which list from the scraper feeds the catalog
const CATALOGS = [
  { id: 'rmz-latest-episodes', key: 'all', name: 'Calendar Episodes' },
  { id: 'rmz-new-series', key: 'new', name: 'New Series' },
  { id: 'rmz-returning-series', key: 'returning', name: 'Returning Series' },
  { id: 'rmz-ongoing-series', key: 'ongoing', name: 'Ongoing Series' },
];
const CATALOG_ID = CATALOGS[0].id;

const manifest = {
  id: 'community.rmz.latestepisodes',
  version: '1.2.0',
  name: 'Calendar Episodes',
  description: 'Shows with the newest episodes listed on rmz.cr, refreshed hourly.',
  resources: ['catalog'],
  types: ['series'],
  catalogs: CATALOGS.map((c) => ({ type: 'series', id: c.id, name: c.name, extra: [{ name: 'skip', isRequired: false }] })),
  idPrefixes: ['tt'],
  behaviorHints: { configurable: false },
};

module.exports = { manifest, CATALOGS, CATALOG_ID, PAGE_SIZE };
