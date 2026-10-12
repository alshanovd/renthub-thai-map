"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

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
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
