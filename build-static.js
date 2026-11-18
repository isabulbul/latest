'use strict';
// Scrapes once and writes the addon as static files (for GitHub Pages).
// Usage: node build-static.js <output-dir>
const fs = require('fs');
const path = require('path');
const { scrape } = require('./scraper');
const { CATALOGS, PAGE_SIZE, withGenres, byGenre } = require('./manifest');
const EXTRA_EMPTY_PAGES = 200; // empty pages beyond the end of each list
const GENRE_EXTRA_PAGES = 20;  // same, for genre-filtered lists
const COMMON_STEPS = [20, 25, 50, 100]; // page sizes clients commonly ask with

(async () => {
  const out = path.resolve(process.argv[2] || 'public');
  const lists = await scrape(); // throws on failure -> nothing is written, old site stays live
  const metas = lists.all;
  const dir = path.join(out, 'catalog', 'series');
  const write = (file, obj) => fs.writeFileSync(file, JSON.stringify(obj));
  fs.mkdirSync(dir, { recursive: true });

  const manifest = withGenres(lists);
  write(path.join(out, 'manifest.json'), manifest);
  const genres = manifest.catalogs[0].extra[0].options;

  // Static hosting cannot answer arbitrary ?skip values, and some clients
  // (Nuvio) ask for the next page even when the first one held everything.
  // Write an answer for every skip a client could send: the rest of the list
  // or an empty page, which tells the client the list ended.
  const skips = (len, extra) => {
    const set = new Set();
    for (let s = 1; s <= len + extra; s++) set.add(s);
    for (const step of COMMON_STEPS) for (let s = step; s <= len + 100; s += step) set.add(s);
    return [...set];
  };

  let files = 0;
  for (const cat of CATALOGS) {
    const all = lists[cat.key] || [];
    fs.mkdirSync(path.join(dir, cat.id), { recursive: true });
    write(path.join(dir, `${cat.id}.json`), { metas: all.slice(0, PAGE_SIZE) });
    for (const s of skips(all.length, EXTRA_EMPTY_PAGES)) {
      write(path.join(dir, cat.id, `skip=${s}.json`), { metas: all.slice(s, s + PAGE_SIZE) });
      files++;
    }
    for (const g of genres) {
      const items = byGenre(all, g);
      write(path.join(dir, cat.id, `genre=${g}.json`), { metas: items.slice(0, PAGE_SIZE) });
      for (const s of skips(items.length, GENRE_EXTRA_PAGES)) {
        write(path.join(dir, cat.id, `genre=${g}&skip=${s}.json`), { metas: items.slice(s, s + PAGE_SIZE) });
        files++;
      }
    }
  }
  console.log(`genres: ${genres.join(', ')} (${files} page files)`);
  fs.writeFileSync(path.join(out, 'index.html'),
    `<!doctype html><meta charset="utf-8"><title>${manifest.name}</title><p>${manifest.name} — ${metas.length} shows, updated ${new Date().toISOString()}</p><p>Install: add this site's <a href="manifest.json">manifest.json</a> URL in Nuvio or Stremio.</p>`);
  console.log(`Wrote ${metas.length} shows to ${out}`);
})().catch((err) => { console.error('Build failed:', err.message); process.exit(1); });
