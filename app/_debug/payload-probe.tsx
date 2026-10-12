"use client";

import type { ListingsPayload } from "@/lib/listings/types";

/**
 * Temporary (plan 06): receives the whole payload as a client prop so the RSC payload of `/`
 * has its real size. Plan 07 replaces it with the map/list client components.
 */
export function PayloadProbe({ payload }: { payload: ListingsPayload }) {
  const withLocation = payload.listings.filter((l) => l.lat !== null).length;
  const pictures = payload.listings.reduce((sum, l) => sum + l.pictures.length, 0);
  return (
    <p className="text-sm text-muted-foreground">
      Client received {payload.listings.length} listings ({withLocation} with location, {pictures}{" "}
      pictures).
    </p>
  );
}
