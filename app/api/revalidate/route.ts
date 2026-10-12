import { timingSafeEqual } from "node:crypto";

import { revalidatePath, revalidateTag } from "next/cache";

import { LISTINGS_TAG } from "@/lib/listings/query";

function secretMatches(given: string | null): boolean {
  const expected = process.env.REVALIDATE_SECRET;
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Called by the scraper after a run: `POST` with header `x-revalidate-secret`. */
export async function POST(request: Request): Promise<Response> {
  if (!secretMatches(request.headers.get("x-revalidate-secret"))) {
    return Response.json({ revalidated: false, error: "unauthorized" }, { status: 401 });
  }
  // Called from outside a Server Action, so `updateTag` isn't available; expire immediately.
  revalidateTag(LISTINGS_TAG, { expire: 0 });
  revalidatePath("/");
  return Response.json({ revalidated: true, at: new Date().toISOString() });
}
