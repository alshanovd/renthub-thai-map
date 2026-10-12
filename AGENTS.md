# renthub-thai-map

Map + list of Chiang Mai daily rentals scraped from renthub.in.th (which has no map).

**Stack:** pnpm, Node 24, ESM, TypeScript strict · Next.js 16 App Router, React 19, Tailwind v4,
shadcn/ui · Neon Postgres + Drizzle ORM (neon-http) · `@vis.gl/react-google-maps` · zustand, nuqs ·
zod · vitest · oxlint + oxfmt · Vercel Hobby (region `sin1`).

**Commands**

- `pnpm check`: typecheck, lint, format check, tests, build. Must pass before every commit.
- `pnpm dev` / `pnpm format` / `pnpm test`
- `pnpm scrape --help`: local scraper (reads `.env.local`).
- `pnpm db:generate` then `pnpm db:migrate`: the only way to change the DB schema.
- `pnpm perf:measure [--url …] [--runs 3] [--json out.json]`: memory harness (installed Chrome via
  playwright-core). Measure `pnpm build && pnpm start` or production, never `pnpm dev`.

**Rules**

- Images are hotlinked from `https://bcdn.renthub.in.th`, never stored or proxied. Use plain `<img>`, not `next/image`.
- Never store owners' contact info (`contactInformation`). Phones, e-mails and LINE ids that
  owners put in free text (description, names, captions) are replaced with `[contact removed]`
  by `redactContacts` in `scripts/scrape/map.ts`. `description` is renthub's raw HTML.
- Schema changes only through drizzle-kit migrations in `drizzle/`.
- Never load a whole scraped payload into context; use `jq` to extract fragments.
- Never print or commit secrets; only `.env.example` is committed.

**Where things live**

- `app/`: routes and API handlers (`app/api/*`) · `components/{top-bar,map,list,viewer,ui}`
- `lib/db/`: Drizzle schema + client · `lib/listings/`: queries, types, filters, formatting
- Data API: `app/api/{pins,listings,listings/no-location}` → `lib/listings/api-query.ts` (cached,
  tag `listings`), SQL in `api-sql.ts`, shared param parsing in `api-params.ts`
- `scripts/scrape/`: scraper (fetch, cache, zod schemas, mapping, persist) + fixtures/tests
- `drizzle/`: generated migrations · `drizzle.config.ts`

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
