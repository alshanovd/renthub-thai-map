"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";

const MINUTE = 60_000;

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * MINUTE,
        // Unobserved data (cards scrolled away, old pin areas) is dropped after a minute.
        gcTime: MINUTE,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}

/** Client-side data providers: one TanStack Query client per browser tab. */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  // Dev only: lets the browser console inspect the cache (e.g. card eviction after scrolling).
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    // oxlint-disable-next-line no-underscore-dangle -- a debug global, named by the plan
    (window as Window & { __rq?: QueryClient }).__rq = queryClient;
  }, [queryClient]);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
