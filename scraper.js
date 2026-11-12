'use strict';
// Fetches rmz.cr and parses the "Latest Episodes" block into Stremio meta previews.
const fs = require('fs');

const SOURCE_URL = process.env.RMZ_URL || 'https://rmz.cr/';
const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || ''; // e.g. http://localhost:8191/v1
const HTML_FILE = process.env.RMZ_HTML_FILE || '';           // offline testing with a saved page
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').trim();
}

function isChallenge(html) {
  return /<title>\s*Just a moment/i.test(html) || /cf-chl-|challenge-platform/i.test(html) && !/Latest Episodes/i.test(html);
}

async function fetchHtml() {
  if (HTML_FILE) return fs.readFileSync(HTML_FILE, 'utf8');

  if (FLARESOLVERR_URL) {
    const res = await fetch(FLARESOLVERR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'request.get', url: SOURCE_URL, maxTimeout: 90000 }),
      signal: AbortSignal.timeout(120000),
    });
    const data = await res.json();
    if (data.status !== 'ok' || !data.solution) throw new Error('FlareSolverr: ' + (data.message || res.status));
    return data.solution.response;
  }

  const res = await fetch(SOURCE_URL, {
    headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(30000),
  });
  const html = await res.text();
  if (isChallenge(html)) throw new Error('Blocked by Cloudflare challenge (HTTP ' + res.status + '). Set FLARESOLVERR_URL.');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return html;
}

// Returns shows in page order (newest first), one entry per show.
function parse(html) {
  const start = html.search(/<h2>\s*Latest Episodes\s*<\/h2>/i);
  if (start < 0) throw new Error('"Latest Episodes" section not found');
  const end = html.indexOf('</ul>', start);
  const section = html.slice(start, end < 0 ? undefined : end);

  const shows = new Map();
  const liRe = /<li>([\s\S]*?)<\/li>/g;
  let m;
  while ((m = liRe.exec(section))) {
    const li = m[1];
    const imdb = /longdesc="\/i\/(\d+)"/.exec(li);
    const link = /<a href="([^"]+)" title="([^"]*)"/.exec(li);
    if (!imdb || !link) continue;
    const id = 'tt' + imdb[1].padStart(7, '0');
    const tag = (/<b>([^<]+)<\/b>/.exec(li) || [])[1] || '';
    let show = shows.get(id);
    if (!show) {
      show = { id, name: decode(link[2]), url: link[1], episodes: [] };
      shows.set(id, show);
    }
    const t = decode(tag);
    if (t && !show.episodes.includes(t)) show.episodes.push(t);
  }
  if (!shows.size) throw new Error('No episodes parsed - site markup may have changed');
  return [...shows.values()];
}

function toMeta(show) {
  const eps = show.episodes.slice(0, 6).join(', ') + (show.episodes.length > 6 ? ', …' : '');
  return {
    id: show.id,
    type: 'series',
    name: show.name,
    poster: `https://images.metahub.space/poster/medium/${show.id}/img`,
    posterShape: 'poster',
    description: eps ? `Latest: ${eps}` : undefined,
  };
}

async function scrape() {
  return parse(await fetchHtml()).map(toMeta);
}

module.exports = { scrape, parse, toMeta };
