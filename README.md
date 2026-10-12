# renthub-thai-map

[renthub.in.th](https://www.renthub.in.th) has no map view: a listing's location is only visible
on its own page. This project scrapes Chiang Mai daily-rent listings into Postgres and shows them
on a Google Map with a list synced to the visible area, photos, favorites and price filters.

- **Scraper** (`scripts/scrape/`): runs locally, reads renthub's public JSON data routes and
  upserts listings into Neon Postgres.
- **Web app** (Next.js 16 on Vercel): map on the right, list on the left.

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
