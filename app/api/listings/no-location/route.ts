import type { NextRequest } from "next/server";

import { apiError, apiJson } from "@/lib/listings/api-http";
import {
  decodeCursor,
  encodeCursor,
  limitFromParam,
  searchFromParams,
} from "@/lib/listings/api-params";
import { getNoLocationPage } from "@/lib/listings/api-query";
import type { NoLocationResponse } from "@/lib/listings/types";

/** `GET ?mode=&max=&call=&sort=&cursor=&limit=` → one page of filtered listings without location. */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const params = request.nextUrl.searchParams;
    const search = searchFromParams(params);
    const offset = decodeCursor(params.get("cursor"));
    const limit = limitFromParam(params.get("limit"));
    const page = await getNoLocationPage(search, offset, limit);
    const body: NoLocationResponse = {
      listings: page.listings,
      nextCursor: page.nextOffset === null ? null : encodeCursor(page.nextOffset),
    };
    return apiJson(body);
  } catch (error) {
    return apiError(error);
  }
}
