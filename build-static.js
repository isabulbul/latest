'use strict';
// Scrapes once and writes the addon as static files (for GitHub Pages).
// Usage: node build-static.js <output-dir>
const fs = require('fs');
const path = require('path');
const { scrape } = require('./scraper');
const { manifest, CATALOGS, PAGE_SIZE } = require('./manifest');
const EXTRA_EMPTY_PAGES = 200; // empty pages beyond the end of each list

(async () => {
  const out = path.resolve(process.argv[2] || 'public');
  const lists = await scrape(); // throws on failure -> nothing is written, old site stays live
  const metas = lists.all;
  const dir = path.join(out, 'catalog', 'series');
  const write = (file, obj) => fs.writeFileSync(file, JSON.stringify(obj));
  fs.mkdirSync(dir, { recursive: true });

  write(path.join(out, 'manifest.json'), manifest);
  for (const cat of CATALOGS) {
    const items = lists[cat.key] || [];
    fs.mkdirSync(path.join(dir, cat.id), { recursive: true });
    write(path.join(dir, `${cat.id}.json`), { metas: items.slice(0, PAGE_SIZE) });
    // Static hosting cannot answer arbitrary ?skip values, and some clients
    // (Nuvio) ask for the next page even when the first one held everything.
    // Write an answer for every skip a client could send: the rest of the list
    // (rarely needed) or an empty page, which tells the client the list ended.
    for (let skip = 1; skip <= items.length + EXTRA_EMPTY_PAGES; skip++) {
      write(path.join(dir, cat.id, `skip=${skip}.json`), { metas: items.slice(skip, skip + PAGE_SIZE) });
    }
  }
  fs.writeFileSync(path.join(out, 'index.html'),
    `<!doctype html><meta charset="utf-8"><title>${manifest.name}</title><p>${manifest.name} — ${metas.length} shows, updated ${new Date().toISOString()}</p><p>Install: add this site's <a href="manifest.json">manifest.json</a> URL in Nuvio or Stremio.</p>`);
  console.log(`Wrote ${metas.length} shows to ${out}`);
})().catch((err) => { console.error('Build failed:', err.message); process.exit(1); });
