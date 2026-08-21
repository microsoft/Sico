/** Exhaustiveness helper for discriminated-union `switch`. */
export function assertNever(value: never): never {
  throw new Error(`unreachable assertNever: ${String(value)}`);
}
