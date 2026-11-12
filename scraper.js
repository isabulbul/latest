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

// ---- Filtering -------------------------------------------------------------
// 1) Season packs ("S01 Pack") are dropped.
// 2) Re-posts of old episodes are dropped: each listed episode's air date is
//    looked up on Cinemeta and must be within MAX_AGE_DAYS.
const FILTER_PACKS = process.env.FILTER_PACKS !== '0';
const MAX_AGE_DAYS = process.env.MAX_AGE_DAYS === undefined ? 14 : +process.env.MAX_AGE_DAYS; // 0 = no date filter
const KEEP_UNKNOWN = process.env.KEEP_UNKNOWN !== '0'; // keep shows/episodes Cinemeta has no date for
const CINEMETA = 'https://v3-cinemeta.strem.io/meta/series/';

async function airDates(id) {
  // Map "season:episode" -> timestamp, or null when the lookup fails.
  try {
    const res = await fetch(`${CINEMETA}${id}.json`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const videos = ((await res.json()).meta || {}).videos || [];
    const map = new Map();
    for (const v of videos) {
      const t = Date.parse(v.released || v.firstAired || '');
      if (!Number.isNaN(t)) map.set(`${+v.season}:${+(v.episode ?? v.number)}`, t);
    }
    return map;
  } catch { return null; }
}

async function filterShows(shows, now = Date.now()) {
  const cutoff = now - MAX_AGE_DAYS * 86400000;
  const stats = { packs: 0, old: 0, unknown: 0 };
  const dropped = { packs: [], old: [] };
  const out = new Array(shows.length).fill(null);
  let next = 0;

  async function worker() {
    while (next < shows.length) {
      const i = next++;
      const show = shows[i];
      let eps = show.episodes;
      if (FILTER_PACKS) {
        eps = eps.filter((t) => /^S\d+E\d+/i.test(t));
        if (!eps.length) { stats.packs++; dropped.packs.push(show.name); continue; }
      }
      if (MAX_AGE_DAYS > 0) {
        const dates = await airDates(show.id);
        if (!dates || !dates.size) {
          stats.unknown++;
          if (!KEEP_UNKNOWN) continue;
        } else {
          eps = eps.filter((t) => {
            const m = /^S(\d+)E(\d+)/i.exec(t);
            if (!m) return false;                       // pack: cannot be dated
            const d = dates.get(`${+m[1]}:${+m[2]}`);
            return d === undefined ? KEEP_UNKNOWN : d >= cutoff;
          });
          if (!eps.length) { stats.old++; dropped.old.push(`${show.name} (${show.episodes.slice(0, 3).join(', ')})`); continue; }
        }
      }
      out[i] = { ...show, episodes: eps };
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  const kept = out.filter(Boolean);
  console.log(`filter: ${shows.length} shows -> ${kept.length} kept (packs only: ${stats.packs}, old re-posts: ${stats.old}, no date info: ${stats.unknown})`);
  if (dropped.old.length) console.log('dropped as old re-posts:\n  ' + dropped.old.sort().join('\n  '));
  if (dropped.packs.length) console.log('dropped as pack only:\n  ' + dropped.packs.sort().join('\n  '));
  return kept;
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
  return (await filterShows(parse(await fetchHtml()))).map(toMeta);
}

module.exports = { scrape, parse, toMeta, filterShows };
