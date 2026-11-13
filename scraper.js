'use strict';
// Fetches rmz.cr and parses the "Latest Episodes" block into Stremio meta previews.
const fs = require('fs');

const SOURCE_URL = process.env.RMZ_URL || 'https://rmz.cr/';
const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || ''; // e.g. http://localhost:8191/v1
const MIRRORS_URL = process.env.RMZ_MIRRORS_URL ?? 'https://rmzmirrors.com/'; // empty = no mirror fallback
const MAX_MIRRORS = +process.env.MAX_MIRRORS || 8;
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

async function fetchUrl(url) {
  if (FLARESOLVERR_URL) {
    const res = await fetch(FLARESOLVERR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'request.get', url, maxTimeout: 90000 }),
      signal: AbortSignal.timeout(120000),
    });
    const data = await res.json();
    if (data.status !== 'ok' || !data.solution) throw new Error('FlareSolverr: ' + (data.message || res.status));
    return data.solution.response;
  }

  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(30000),
  });
  const html = await res.text();
  if (isChallenge(html)) throw new Error('Blocked by Cloudflare challenge (HTTP ' + res.status + '). Set FLARESOLVERR_URL.');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return html;
}

const hasList = (html) => /<h2>\s*Latest Episodes\s*<\/h2>/i.test(html);

// Reads the mirror list page and returns candidate site URLs (best guesses first).
// The page layout is not relied on: every external host mentioned on it is a
// candidate, and a candidate only counts if it really serves the episode list.
function extractMirrors(html, exclude) {
  const skip = /(^|\.)(google|gstatic|googleapis|cloudflare|cloudflareinsights|jquery|jsdelivr|w3|schema|facebook|twitter|x|t|telegram|discord|reddit|github|bootstrapcdn|fontawesome|unpkg)\.(com|org|net|me|io|gg)$/i;
  const hosts = new Set();
  const re = /(?:https?:)?\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)|(?<![\w.@/-])([a-z0-9-]*(?:rmz|rapidmoviez)[a-z0-9-]*\.[a-z]{2,10})(?![\w-])/gi;
  let m;
  while ((m = re.exec(html))) {
    const host = (m[1] || m[2]).toLowerCase().replace(/^www\./, '');
    if (!exclude.includes(host) && !skip.test(host) && !/\.(png|jpe?g|gif|svg|css|js|ico|webp)$/.test(host)) hosts.add(host);
  }
  const score = (h) => (/rmz|rapidmoviez/.test(h) ? 0 : 1);
  return [...hosts].sort((x, y) => score(x) - score(y)).slice(0, MAX_MIRRORS).map((h) => `https://${h}/`);
}

async function fetchHtml() {
  if (HTML_FILE) return fs.readFileSync(HTML_FILE, 'utf8');

  const tried = [];
  const attempt = async (url) => {
    try {
      const html = await fetchUrl(url);
      if (hasList(html)) { console.log(`source: ${url}`); return html; }
      tried.push(`${url} (no episode list)`);
    } catch (err) { tried.push(`${url} (${err.message})`); }
    return null;
  };

  let html = await attempt(SOURCE_URL);
  if (html || !MIRRORS_URL) { if (html) return html; throw new Error('No working source. Tried: ' + tried.join('; ')); }

  // Main site failed: ask the mirror list for alternatives.
  let mirrors = [];
  try {
    const page = await fetchUrl(MIRRORS_URL);
    mirrors = extractMirrors(page, [new URL(MIRRORS_URL).hostname.replace(/^www\./, ''), new URL(SOURCE_URL).hostname.replace(/^www\./, '')]);
    console.log(`mirror list: ${mirrors.length ? mirrors.join(', ') : 'no candidates found'}`);
  } catch (err) { tried.push(`${MIRRORS_URL} (${err.message})`); }
  for (const url of mirrors) {
    html = await attempt(url);
    if (html) return html;
  }
  throw new Error('No working source. Tried: ' + tried.join('; '));
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
  let pos = 0; // position in the site's list, newest first
  while ((m = liRe.exec(section))) {
    pos++;
    const li = m[1];
    const imdb = /longdesc="\/i\/(\d+)"/.exec(li);
    // First <a> of the item is the show link; read its attributes in any order.
    const anchor = (/<a\b[^>]*>/i.exec(li) || [''])[0];
    const href = /\bhref="([^"]+)"/i.exec(anchor);
    const title = /\btitle="([^"]*)"/i.exec(anchor);
    if (!imdb || !href || !title) continue;
    const link = [null, href[1], title[1]];
    const id = 'tt' + imdb[1].padStart(7, '0');
    const tag = (/<b>([^<]+)<\/b>/.exec(li) || [])[1] || '';
    let show = shows.get(id);
    if (!show) {
      show = { id, name: decode(link[2]), url: link[1], episodes: [], pos: {} };
      shows.set(id, show);
    }
    const t = decode(tag);
    if (t && !show.episodes.includes(t)) { show.episodes.push(t); show.pos[t] = pos; }
  }
  if (!shows.size) throw new Error('No episodes parsed - site markup may have changed');
  return [...shows.values()];
}

// ---- Filtering -------------------------------------------------------------
// 1) Season packs ("S01 Pack") are dropped.
// 2) Re-posts of old episodes are dropped: each listed episode's air date is
//    looked up on Cinemeta and must be within MAX_AGE_DAYS.
// 3) Optional (FILTER_DAILY=1): daily shows (soaps, late-night/talk shows, news) are dropped: by genre, or
//    when episodes aired on DAILY_MIN_DAYS or more different days in the last 14.
const FILTER_PACKS = process.env.FILTER_PACKS !== '0';
const MAX_AGE_DAYS = process.env.MAX_AGE_DAYS === undefined ? 14 : +process.env.MAX_AGE_DAYS; // 0 = no date filter
const KEEP_UNKNOWN = process.env.KEEP_UNKNOWN !== '0'; // keep shows/episodes Cinemeta has no date for
const FILTER_DAILY = process.env.FILTER_DAILY === '1'; // off by default
const DAILY_MIN_DAYS = +process.env.DAILY_MIN_DAYS || 5;
const EXCLUDE_GENRES = (process.env.EXCLUDE_GENRES ?? 'Talk-Show,News').split(',').map((g) => g.trim().toLowerCase()).filter(Boolean);
const CINEMETA = 'https://v3-cinemeta.strem.io/meta/series/';
const DAY = 86400000;

async function cinemeta(id) {
  // { dates: Map "season:episode" -> timestamp, genres: [lowercase] }, or null when the lookup fails.
  try {
    const res = await fetch(`${CINEMETA}${id}.json`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const meta = (await res.json()).meta || {};
    const dates = new Map();
    for (const v of meta.videos || []) {
      const t = Date.parse(v.released || v.firstAired || '');
      if (!Number.isNaN(t)) dates.set(`${+v.season}:${+(v.episode ?? v.number)}`, t);
    }
    const genres = (meta.genres || meta.genre || []).map((g) => String(g).toLowerCase());
    return { dates, genres };
  } catch { return null; }
}

function isDaily(info, now) {
  const genre = info.genres.find((g) => EXCLUDE_GENRES.includes(g));
  if (genre) return `genre: ${genre}`;
  const days = new Set();
  for (const [key, t] of info.dates) {
    if (key.startsWith('0:')) continue; // specials
    if (t >= now - 14 * DAY && t <= now + DAY) days.add(Math.floor(t / DAY));
  }
  return days.size >= DAILY_MIN_DAYS ? `aired on ${days.size} of the last 14 days` : null;
}

// new       = season 1 whose first episode aired within NEW_DAYS
// returning = season 2+ whose season premiere aired within RETURNING_DAYS
// ongoing   = everything further into its run (any season)
const NEW_DAYS = +process.env.NEW_DAYS || 14;
const RETURNING_DAYS = +process.env.RETURNING_DAYS || 14;
function classify(eps, info, now) {
  let season = 0;
  let hasPremiere = false;
  for (const t of eps) {
    const m = /^S(\d+)E(\d+)/i.exec(t);
    if (!m) continue;
    if (+m[1] > season) { season = +m[1]; hasPremiere = false; }
    if (+m[1] === season && +m[2] === 1) hasPremiere = true;
  }
  const fresh = season <= 1 ? 'new' : 'returning';
  const days = season <= 1 ? NEW_DAYS : RETURNING_DAYS;
  const premiere = info ? info.dates.get(`${Math.max(season, 1)}:1`) : undefined;
  if (premiere !== undefined) return premiere >= now - days * DAY ? fresh : 'ongoing';
  return hasPremiere ? fresh : 'ongoing'; // no air date: go by whether episode 1 is in the list
}

async function filterShows(shows, now = Date.now()) {
  const cutoff = now - MAX_AGE_DAYS * DAY;
  const dropped = { packs: [], old: [], daily: [] };
  let unknown = 0;
  const out = new Array(shows.length).fill(null);
  let next = 0;

  async function worker() {
    while (next < shows.length) {
      const i = next++;
      const show = shows[i];
      let eps = show.episodes;
      if (FILTER_PACKS) {
        eps = eps.filter((t) => /^S\d+E\d+/i.test(t));
        if (!eps.length) { dropped.packs.push(show.name); continue; }
      }
      let info = null;
      { // air dates: needed for the age filter and to classify
        info = await cinemeta(show.id);
        if (!info || !info.dates.size) {
          unknown++;
          if (!KEEP_UNKNOWN) continue;
        } else {
          const why = FILTER_DAILY && isDaily(info, now);
          if (why) { dropped.daily.push(`${show.name} (${why})`); continue; }
          if (MAX_AGE_DAYS > 0) {
            eps = eps.filter((t) => {
              const m = /^S(\d+)E(\d+)/i.exec(t);
              if (!m) return false;                       // pack: cannot be dated
              const d = info.dates.get(`${+m[1]}:${+m[2]}`);
              return d === undefined ? KEEP_UNKNOWN : d >= cutoff;
            });
            if (!eps.length) { dropped.old.push(`${show.name} (${show.episodes.slice(0, 3).join(', ')})`); continue; }
          }
        }
      }
      out[i] = { ...show, episodes: eps, category: classify(eps, info, now) };
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  // Order by the list position of each show's newest *surviving* entry, so a
  // dropped pack or old re-post higher up does not pull the show forward.
  const rank = (s) => Math.min(...s.episodes.map((t) => (s.pos && s.pos[t]) || Infinity));
  const kept = out.filter(Boolean).sort((a, b) => rank(a) - rank(b));
  console.log(`filter: ${shows.length} shows -> ${kept.length} kept (packs only: ${dropped.packs.length}, old re-posts: ${dropped.old.length}, daily shows: ${dropped.daily.length}, no date info: ${unknown})`);
  for (const [label, list] of [['daily shows', dropped.daily], ['old re-posts', dropped.old], ['pack only', dropped.packs]]) {
    if (list.length) console.log(`dropped as ${label}:\n  ` + list.sort().join('\n  '));
  }
  return kept;
}

// Highest season/episode among the listed tags, e.g. "S03E06".
function newestEpisode(episodes) {
  let best = '';
  let bestKey = -1;
  for (const t of episodes) {
    const m = /^S(\d+)E(\d+)/i.exec(t);
    if (!m) continue;
    const key = +m[1] * 10000 + +m[2];
    if (key > bestKey) { bestKey = key; best = t; }
  }
  return best || episodes[0] || '';
}

const EP_IN_NAME = process.env.EP_IN_NAME === '1'; // off: Nuvio already shows releaseInfo under the title

function toMeta(show) {
  const eps = show.episodes.slice(0, 6).join(', ') + (show.episodes.length > 6 ? ', …' : '');
  const latest = newestEpisode(show.episodes);
  return {
    id: show.id,
    type: 'series',
    name: latest && EP_IN_NAME ? `${show.name} (${latest})` : show.name,
    releaseInfo: latest || undefined,
    poster: `https://images.metahub.space/poster/medium/${show.id}/img`,
    background: `https://images.metahub.space/background/medium/${show.id}/img`,
    logo: `https://images.metahub.space/logo/medium/${show.id}/img`,
    posterShape: 'poster',
    description: eps ? `Latest: ${eps}` : undefined,
  };
}

async function scrape() {
  const shows = await filterShows(parse(await fetchHtml()));
  const lists = { all: [], new: [], returning: [], ongoing: [] };
  for (const show of shows) {
    const meta = toMeta(show);
    lists.all.push(meta);
    lists[show.category].push(meta);
  }
  console.log(`catalogs: all ${lists.all.length}, new ${lists.new.length}, returning ${lists.returning.length}, ongoing ${lists.ongoing.length}`);
  return lists;
}

module.exports = { scrape, parse, toMeta, filterShows, extractMirrors };
