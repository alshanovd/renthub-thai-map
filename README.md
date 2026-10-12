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

## Environment variables

| Name                              | Where                                   | Purpose                                                                                       |
| --------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                    | Vercel (Neon integration), `.env.local` | Pooled Postgres connection (app and scraper)                                                  |
| `DATABASE_URL_UNPOOLED`           | same                                    | Direct connection for `drizzle-kit` migrations                                                |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Vercel, `.env.local`                    | Maps JavaScript API key, restricted to this site's referrers and `localhost:3000`             |
| `NEXT_PUBLIC_GOOGLE_MAP_ID`       | Vercel, `.env.local`                    | Map ID for Advanced Markers (`DEMO_MAP_ID` by default)                                        |
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
