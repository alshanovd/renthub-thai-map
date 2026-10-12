"use client";

import { parseAsString, useQueryState } from "nuqs";
import { useEffect, useRef } from "react";

import { useMapUi } from "@/lib/store";

const idParam = parseAsString.withOptions({ history: "replace", shallow: true });

/**
 * Two-way sync between the store's `selectedId` and `?id=`.
 * - URL → store on first load (and on any external URL change), with source `"url"`, which makes
 *   the map pan to the pin once and the list scroll to the card once.
 * - store → URL on every selection change (`history: "replace"`, shallow).
 * `synced` remembers the last value both sides agreed on, so neither direction echoes back.
 * Uses `useSearchParams` under the hood: render it inside `<Suspense>` to keep `/` prerendered.
 */
export function SelectionUrlSync() {
  const [urlId, setUrlId] = useQueryState("id", idParam);
  const synced = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (urlId === synced.current) return;
    synced.current = urlId;
    const { selectedId, select } = useMapUi.getState();
    if (urlId !== selectedId) select(urlId, urlId === null ? null : "url");
  }, [urlId]);

  useEffect(
    () =>
      useMapUi.subscribe((state, prev) => {
        if (state.selectedId === prev.selectedId || state.selectedId === synced.current) return;
        synced.current = state.selectedId;
        void setUrlId(state.selectedId);
      }),
    [setUrlId],
  );

  return null;
}
