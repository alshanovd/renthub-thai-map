import type { NextRequest } from "next/server";
import { z } from "zod";

import { getListingsByIds } from "@/lib/listings/query";

const MAX_IDS = 200;

const idsSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value) =>
    value
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  )
  .pipe(
    z
      .array(
        z
          .string()
          .max(64)
          .regex(/^[\w-]+$/),
      )
      .min(1)
      .max(MAX_IDS),
  );

const noStore = { "Cache-Control": "no-store" };

/** `GET ?ids=1,2,3` (≤ 200 ids) → `ListingSummary[]`, soft-deleted listings included. */
export async function GET(request: NextRequest): Promise<Response> {
  const parsed = idsSchema.safeParse(request.nextUrl.searchParams.get("ids") ?? "");
  if (!parsed.success) {
    return Response.json(
      { error: `ids must be 1–${String(MAX_IDS)} comma-separated listing ids` },
      { status: 400, headers: noStore },
    );
  }
  const listings = await getListingsByIds(parsed.data);
  return Response.json(listings, { headers: noStore });
}
