"use client";

import { useQueryStates } from "nuqs";
import { useEffect, useRef } from "react";

import {
  appliedSearchStore,
  searchFromUrl,
  searchParsers,
  searchToUrl,
  serializeSearch,
  searchUrlOptions,
} from "@/lib/search-params";

/**
 * Two-way sync between the applied-search store and `?mode=&max=&call=&sort=`.
 * - URL → store on first load and on any external URL change (values are normalized, so an
 *   out-of-range `max` is clamped).
 * - store → URL whenever the applied search changes. Only these four keys are written, so `?id=`
 *   (owned by `SelectionUrlSync`) is left alone.
 * Both directions compare normalized values (`setSearch` ignores equal searches) and URL → store
 * runs only when the query string actually changed, so they never echo.
 * Uses `useSearchParams` under the hood: render it inside `<Suspense>`.
 */
export function SearchUrlSync() {
  const [url, setUrl] = useQueryStates(searchParsers, searchUrlOptions);
  const urlKey = serializeSearch(url);
  const lastUrlKey = useRef<string | null>(null);

  useEffect(() => {
    // React only to actual URL changes, never to re-renders with the same query.
    if (urlKey === lastUrlKey.current) return;
    lastUrlKey.current = urlKey;
    const search = searchFromUrl(url);
    appliedSearchStore.getState().setSearch(search);
    // Rewrite a non-canonical URL (clamped `max`, explicit defaults) to the normalized search.
    const canonical = searchToUrl(search);
    if (serializeSearch(canonical) !== urlKey) void setUrl(canonical);
  }, [url, urlKey, setUrl]);

  useEffect(
    () =>
      appliedSearchStore.subscribe((state, prev) => {
        if (state.search === prev.search) return;
        void setUrl(searchToUrl(state.search));
      }),
    [setUrl],
  );

  return null;
}
