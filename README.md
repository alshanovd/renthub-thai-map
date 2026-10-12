# renthub-thai-map

[renthub.in.th](https://www.renthub.in.th) has no map view: a listing's location is only visible
on its own page. This project scrapes Chiang Mai daily-rent listings into Postgres and shows them
on a Google Map with a list synced to the visible area, photos, favorites and price filters.

- **Scraper** (`scripts/scrape/`): runs locally, reads renthub's public JSON data routes and
  upserts listings into Neon Postgres.
- **Web app** (Next.js 16 on Vercel): map on the right, list on the left.

**Live:** https://renthub-thai-map.vercel.app (pushing to `main` deploys production).

## Local development

Requires Node 24 and pnpm.

```sh
pnpm install
cp .env.example .env.local   # fill in the values
pnpm db:migrate              # apply migrations to the database
pnpm dev                     # http://localhost:3000
```

Before committing, run `pnpm check` (typecheck, lint, format check, tests, build).

## Running the scraper

```sh
pnpm scrape --help
pnpm scrape                  # full daily Chiang Mai scrape into DATABASE_URL
```

The scraper reads `.env.local`. Photos are hotlinked from renthub's CDN, never stored, and owner
contact details are never saved.

## Refreshing the live data

The data only changes when you run the scraper; there is no cron.

```sh
pnpm scrape
```

It fetches the listings (responses are cached in `.cache/` for 12 hours, so a rerun within that
window makes no requests to renthub), upserts them into the production database and soft-deletes
listings that disappeared. When `REVALIDATE_URL` is set it then calls
`POST /api/revalidate` with `REVALIDATE_SECRET`, and the log ends with `revalidate: HTTP 200`.
The site serves the new data on the next request; "Updated …" in the top bar shows the time of
the last successful full scrape.

## Architecture: data loading

The browser holds only what the current view needs. `/` is a static shell with no listing data;
everything arrives from the app's own JSON API.

**Endpoints** (search params: `mode=day|month`, `max`, `call=0|1`, `sort=price-asc|price-desc|updated`):

| Endpoint                                         | Returns                                                                                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/pins?…&bbox=south,west,north,east`     | Compact pins (`[id, lat, lng, price, kind]` tuples) for active listings with a location inside the box, in sort order, plus `total`, `noLocationTotal` and `lastScrapeAt` |
| `GET /api/listings?ids=a,b,…` (max 100)          | Card data for those ids (unknown ids omitted, soft-deleted ones flagged `deleted`)                                                                                        |
| `GET /api/listings/no-location?…&cursor=&limit=` | One page of filtered listings without coordinates, and `nextCursor`                                                                                                       |
| `POST /api/revalidate` (secret)                  | Invalidates the server cache after a scrape                                                                                                                               |

**Caching and revalidation.** The queries are `"use cache"` functions tagged `listings`
(`cacheLife("days")`); the scraper's `POST /api/revalidate` expires the tag. API responses send
`Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=300`, so after a scrape the
CDN may serve old data for a few minutes at most.

**Client.** TanStack Query holds the data:

- The map's visible bounds are expanded by 25% per side and snapped outwards to a zoom-dependent
  grid, so small pans reuse the same `/api/pins` request; superseded requests are aborted.
- Cards are cached per id (`["card", id]`). A batching loader turns all ids requested within
  ~16 ms into one `/api/listings?ids=` call. Unused cards are evicted after 60 s.
- The list is virtualized (`@tanstack/react-virtual`, rows of the 2-column grid): only the cards
  near the visible part are mounted, each with a single photo; carousel neighbours preload on
  arrow hover/focus. The viewer mounts one full image and preloads its neighbours.
- Pins are drawn by one imperative layer (`components/map/pin-layer.tsx`): plain-DOM pills inside
  `AdvancedMarkerElement`s, diffed by id, clustered by `@googlemaps/markerclusterer`
  (radius 80 px, no clustering above zoom 14). Only the hover preview is a React marker.
- Map tiles are raster by default (`NEXT_PUBLIC_MAP_RENDERING=vector` opts into vector tiles,
  which measured about 85 MB more browser memory).

**Measuring memory.** `pnpm perf:measure [--url http://localhost:3000] [--runs 3] [--json out.json]`
drives the installed Google Chrome through a fixed scenario (pan and zoom the map, scroll the
list, hover pins, step carousels, open the viewer) and prints JS heap, DOM, image, transfer and
browser-process RSS figures. Measure `pnpm build && pnpm start` or the live site, never
`pnpm dev`.

## Environment variables

| Name                              | Where                                   | Purpose                                                                                       |
| --------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                    | Vercel (Neon integration), `.env.local` | Pooled Postgres connection (app and scraper)                                                  |
| `DATABASE_URL_UNPOOLED`           | same                                    | Direct connection for `drizzle-kit` migrations                                                |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Vercel, `.env.local`                    | Maps JavaScript API key, restricted to this site's referrers and `localhost:3000`             |
| `NEXT_PUBLIC_GOOGLE_MAP_ID`       | Vercel, `.env.local`                    | Map ID for Advanced Markers (`DEMO_MAP_ID` by default)                                        |
| `NEXT_PUBLIC_MAP_RENDERING`       | optional                                | Map tiles: unset/`raster` (default, lighter) or `vector`                                      |
| `REVALIDATE_SECRET`               | Vercel, `.env.local`                    | Shared secret for `/api/revalidate`                                                           |
| `REVALIDATE_URL`                  | `.env.local` only                       | `https://renthub-thai-map.vercel.app/api/revalidate`; the scraper skips revalidation if empty |

`NEXT_PUBLIC_*` values are inlined at build time, so redeploy after changing them. The Vercel
values are stored as plain config, so `vercel env pull .env.local` fills a fresh checkout (add
`REVALIDATE_URL` by hand).

## Adding monthly listings later

The scraper runs every search listed in `scripts/scrape/searches.ts`. To add renthub's monthly
Chiang Mai search, uncomment the `monthly` entry there
(`/en/apartment/chiang-mai`, `rentalType: "MONTHLY"`) and run `pnpm scrape`. Listings found by
both searches are stored once, with both keys in `source_searches`. The app already filters and
sorts by monthly prices in "Per month" mode.
