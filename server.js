'use strict';
const http = require('http');
const { scrape } = require('./scraper');

const PORT = +process.env.PORT || 7000;
const REFRESH_MS = (+process.env.REFRESH_MINUTES || 60) * 60 * 1000;
const { manifest, CATALOGS, PAGE_SIZE } = require('./manifest');


const cache = { lists: { all: [] }, updatedAt: 0, lastError: null };
let inFlight = null;

function refresh() {
  if (inFlight) return inFlight;
  inFlight = scrape()
    .then((lists) => {
      cache.lists = lists; cache.updatedAt = Date.now(); cache.lastError = null;
      console.log(`[${new Date().toISOString()}] refreshed: ${lists.all.length} shows`);
    })
    .catch((err) => {
      cache.lastError = err.message; // keep serving the previous list
      console.error(`[${new Date().toISOString()}] refresh failed: ${err.message}`);
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

function send(res, status, body, maxAge = 0) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-cache',
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);

  if (path === '/' || path === '/manifest.json') return send(res, 200, manifest, 3600);

  if (path === '/health') {
    return send(res, 200, { shows: cache.lists.all.length, updatedAt: cache.updatedAt ? new Date(cache.updatedAt).toISOString() : null, lastError: cache.lastError });
  }

  // /catalog/series/<id>.json  or  /catalog/series/<id>/skip=100.json
  const m = /^\/catalog\/series\/([^/]+?)(?:\/([^/]+))?\.json$/.exec(path);
  const cat = m && CATALOGS.find((c) => c.id === m[1]);
  if (cat) {
    if (!cache.updatedAt) await refresh(); // first request before initial scrape finished
    const skip = Math.max(0, +(new URLSearchParams(m[2] || '').get('skip')) || 0);
    // Remaining time until the next hourly refresh, so clients re-ask right after it.
    const age = Math.floor((Date.now() - cache.updatedAt) / 1000);
    const maxAge = cache.updatedAt ? Math.max(60, Math.min(3600, REFRESH_MS / 1000 - age)) : 60;
    return send(res, 200, { metas: (cache.lists[cat.key] || []).slice(skip, skip + PAGE_SIZE) }, maxAge);
  }

  send(res, 404, { err: 'not found' });
});

server.listen(PORT, () => {
  console.log(`Addon running: http://127.0.0.1:${PORT}/manifest.json`);
  refresh();
  setInterval(refresh, REFRESH_MS);
});
