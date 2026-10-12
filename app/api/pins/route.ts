import type { NextRequest } from "next/server";

import { apiError, apiJson } from "@/lib/listings/api-http";
import { bboxFromParam, searchFromParams } from "@/lib/listings/api-params";
import { getLastScrapeAt, getPins, getSearchTotals } from "@/lib/listings/api-query";
import type { PinsResponse } from "@/lib/listings/types";

/** `GET ?bbox=s,w,n,e&mode=&max=&call=&sort=` → `PinsResponse`. */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const params = request.nextUrl.searchParams;
    const bbox = bboxFromParam(params.get("bbox"));
    const search = searchFromParams(params);
    const [pins, totals, lastScrapeAt] = await Promise.all([
      getPins(bbox, search),
      getSearchTotals(search),
      getLastScrapeAt(),
    ]);
    const body: PinsResponse = { lastScrapeAt, ...totals, pins };
    return apiJson(body);
  } catch (error) {
    return apiError(error);
  }
}
