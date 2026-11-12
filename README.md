# RMZ Latest Episodes — Stremio / Nuvio catalog addon

Serves the "Latest Episodes" list from https://rmz.cr as a series catalog.
Catalog only: items carry IMDb ids, so details and streams come from your other addons.

## No server: GitHub Pages (free)

1. Create a **public** GitHub repository and upload all files of this folder (including `.github/`).
2. Repository Settings → Pages → Source: **GitHub Actions**.
3. Actions tab → "Refresh catalog" → Run workflow. It then runs hourly by itself.
4. Install `https://<username>.github.io/<repo>/manifest.json` in Nuvio.

If a run fails (e.g. the Cloudflare check is not passed), the previously published list stays online.

## Run on your own machine

With Docker (includes FlareSolverr, needed to pass the site's Cloudflare check):

    docker compose up -d

Without Docker (Node 18+, no dependencies):

    FLARESOLVERR_URL=http://localhost:8191/v1 node server.js

## Install

Add `http://<host>:7000/manifest.json` in Nuvio (Settings → Addons → Add Addon) or Stremio.
Stremio only accepts plain http for 127.0.0.1; from another device, put the addon behind HTTPS.

## Settings (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 7000 | Listen port |
| `REFRESH_MINUTES` | 60 | Scrape interval |
| `FLARESOLVERR_URL` | – | FlareSolverr endpoint, e.g. `http://localhost:8191/v1` |
| `RMZ_URL` | https://rmz.cr/ | Source page |
| `RMZ_HTML_FILE` | – | Parse a saved page instead of fetching (testing) |

`/health` shows the show count, last refresh time and last error.
If a refresh fails, the previous list keeps being served.
