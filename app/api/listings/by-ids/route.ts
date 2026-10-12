import type { NextRequest } from "next/server";

import { apiError, apiJson } from "@/lib/listings/api-http";
import { idsFromParam } from "@/lib/listings/api-params";
import { getListingCards } from "@/lib/listings/api-query";

const MAX_IDS = 200;

/**
 * Legacy alias of `GET /api/listings?ids=` kept for the current favorites code:
 * `?ids=1,2,3` (≤ 200 ids) → `ListingSummary[]` (a bare array), soft-deleted listings included.
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ids = idsFromParam(request.nextUrl.searchParams.get("ids"), MAX_IDS);
    return apiJson(await getListingCards(ids));
  } catch (error) {
    return apiError(error);
  }
}
