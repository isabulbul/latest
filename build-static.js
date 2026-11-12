'use strict';
// Scrapes once and writes the addon as static files (for GitHub Pages).
// Usage: node build-static.js <output-dir>
const fs = require('fs');
const path = require('path');
const { scrape } = require('./scraper');
const { manifest, CATALOG_ID, PAGE_SIZE } = require('./manifest');

(async () => {
  const out = path.resolve(process.argv[2] || 'public');
  const metas = await scrape(); // throws on failure -> nothing is written, old site stays live
  const dir = path.join(out, 'catalog', 'series');
  fs.mkdirSync(path.join(dir, CATALOG_ID), { recursive: true });
  const write = (file, obj) => fs.writeFileSync(file, JSON.stringify(obj));

  write(path.join(out, 'manifest.json'), manifest);
  write(path.join(dir, `${CATALOG_ID}.json`), { metas: metas.slice(0, PAGE_SIZE) });
  // Further pages, plus one empty page so clients know the list has ended.
  for (let skip = PAGE_SIZE; skip < metas.length + PAGE_SIZE; skip += PAGE_SIZE) {
    write(path.join(dir, CATALOG_ID, `skip=${skip}.json`), { metas: metas.slice(skip, skip + PAGE_SIZE) });
  }
  fs.writeFileSync(path.join(out, 'index.html'),
    `<!doctype html><meta charset="utf-8"><title>${manifest.name}</title><p>${manifest.name} — ${metas.length} shows, updated ${new Date().toISOString()}</p><p>Install: add this site's <a href="manifest.json">manifest.json</a> URL in Nuvio or Stremio.</p>`);
  console.log(`Wrote ${metas.length} shows to ${out}`);
})().catch((err) => { console.error('Build failed:', err.message); process.exit(1); });
