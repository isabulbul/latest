'use strict';
const CATALOG_ID = 'rmz-latest-episodes';
const PAGE_SIZE = 100;

const manifest = {
  id: 'community.rmz.latestepisodes',
  version: '1.0.0',
  name: 'RMZ Latest Episodes',
  description: 'Shows with the newest episodes listed on rmz.cr, refreshed hourly.',
  resources: ['catalog'],
  types: ['series'],
  catalogs: [{ type: 'series', id: CATALOG_ID, name: 'RMZ Latest Episodes', extra: [{ name: 'skip', isRequired: false }] }],
  idPrefixes: ['tt'],
  behaviorHints: { configurable: false },
};

module.exports = { manifest, CATALOG_ID, PAGE_SIZE };
