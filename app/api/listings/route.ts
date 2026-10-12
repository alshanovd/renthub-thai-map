import type { NextRequest } from "next/server";

import { apiError, apiJson } from "@/lib/listings/api-http";
import { idsFromParam } from "@/lib/listings/api-params";
import { getListingCards } from "@/lib/listings/api-query";
import type { ListingCardsResponse } from "@/lib/listings/types";

/** `GET ?ids=a,b,…` (1–100) → `{ listings: ListingCard[] }`, soft-deleted listings included. */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ids = idsFromParam(request.nextUrl.searchParams.get("ids"));
    const body: ListingCardsResponse = { listings: await getListingCards(ids) };
    return apiJson(body);
  } catch (error) {
    return apiError(error);
  }
}
