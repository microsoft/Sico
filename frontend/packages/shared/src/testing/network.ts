// Test helpers for simulating `navigator.onLine` transitions.
// `configurable: true` lets the same test run flip the value repeatedly
// (jsdom defines `onLine` as a non-writable getter).

export function setOnline(value: boolean): void {
  Object.defineProperty(navigator, "onLine", {
    value,
    configurable: true,
  });
}

// Use when the code under test listens for the event (e.g.
// `useSyncExternalStore` subscribers) rather than reading the property.
export function fireNetworkStatus(value: boolean): void {
  setOnline(value);
  window.dispatchEvent(new Event(value ? "online" : "offline"));
}

export function restoreOnline(): void {
  setOnline(true);
}
