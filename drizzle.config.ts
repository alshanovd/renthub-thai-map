import { defineConfig } from "drizzle-kit";

try {
  process.loadEnvFile?.(".env.local");
} catch {
  // No .env.local (e.g. CI): rely on the process environment.
}

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: url ?? "" },
});
