import { QueryClient } from "@tanstack/react-query";

// 3 retries with exp back-off (1s, 2s, 4s, … capped at 30s) covers
// transient 5xx and proxy hiccups without long user-facing waits.
export const QUERY_RETRY_COUNT = 3;
export const QUERY_RETRY_BASE_MS = 1_000;
export const QUERY_RETRY_MAX_MS = 30_000;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: QUERY_RETRY_COUNT,
        retryDelay: (attemptIndex: number): number =>
          Math.min(QUERY_RETRY_BASE_MS * 2 ** attemptIndex, QUERY_RETRY_MAX_MS),
      },
    },
  });
}
