import { unstable_rethrow } from "next/navigation";

import { ParamError } from "./api-params";

/** CDN-cacheable for a minute, then served stale for up to 5 min while revalidating. */
export const API_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
} as const;

export function apiJson(body: unknown): Response {
  return Response.json(body, { headers: API_CACHE_HEADERS });
}

/**
 * `ParamError` → 400 `{ error }`; anything else → 500 without details (logged server-side).
 * Next's internal errors (e.g. the prerender bail-out on `searchParams`) are rethrown.
 */
export function apiError(error: unknown): Response {
  unstable_rethrow(error);
  const headers = { "Cache-Control": "no-store" };
  if (error instanceof ParamError) {
    return Response.json({ error: error.message }, { status: 400, headers });
  }
  console.error("API error:", error);
  return Response.json({ error: "internal error" }, { status: 500, headers });
}
