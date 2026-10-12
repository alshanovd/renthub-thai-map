"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Below Tailwind's `md` breakpoint (48rem): map full screen, list in a bottom sheet. */
export const MOBILE_QUERY = "(max-width: 767.98px)";

/**
 * Whether a media query matches. SSR-safe: the server (prerender) and hydration always see
 * `false`, then the client re-renders with the real value, so there's never a hydration mismatch.
 * Layout that must not flash on phones is handled by CSS breakpoints; this hook only decides
 * what to mount (e.g. the bottom sheet) after hydration.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** `true` under the `md` breakpoint (after hydration). */
export const useIsMobile = () => useMediaQuery(MOBILE_QUERY);
