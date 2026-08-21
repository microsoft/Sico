/** No-op with a stable identity — a safe default for an optional callback that
 *  hasn't been wired yet (a fresh inline `() => {}` would change identity each
 *  render and defeat memoization). */
export function noop(): void {
  // intentionally empty
}
