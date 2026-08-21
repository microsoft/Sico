import { createQueryClient } from "@sico/shared";
import type { QueryClient } from "@tanstack/react-query";

// Module-scope singleton: survives StrictMode's double-mount, and is
// safe to read from `router.ts` (which builds the typed RouterContext
// at module load) without an `undefined!` placeholder.
export const queryClient: QueryClient = createQueryClient();
