// Async data state for a select field — drives loading / error / empty
// affordances so a slow or failed fetch isn't a silently blank dropdown.
export type LoadState = "loading" | "error" | "empty" | "ready";

// Collapse a react-query result (pending/error + item count) into a single
// LoadState the Add DW select fields render from.
export function deriveState(
  isPending: boolean,
  isError: boolean,
  count: number,
): LoadState {
  if (isPending) {
    return "loading";
  }
  if (isError) {
    return "error";
  }
  return count === 0 ? "empty" : "ready";
}

// Trigger placeholder for a select, varying by load state.
export function placeholderFor(
  state: LoadState,
  ready: string,
  noun: string,
): string {
  if (state === "loading") {
    return `Loading ${noun}…`;
  }
  if (state === "error") {
    return `Couldn't load ${noun}`;
  }
  return ready;
}
