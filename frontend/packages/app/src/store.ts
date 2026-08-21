import { createStore } from "jotai";

// Named module-scope store: the provider and the axios 401 handler must
// mutate the same atom state, and tests assert against it directly.
export const store = createStore();
