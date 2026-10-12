import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";

import * as schema from "./schema";

export { schema };

export type Db = NeonHttpDatabase<typeof schema>;

let db: Db | undefined;

/** Lazily creates (and caches) a Drizzle client over Neon's HTTP driver. */
export function getDb(): Db {
  if (db) return db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  db = drizzle(neon(url), { schema });
  return db;
}
