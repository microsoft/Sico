import { z } from "zod";

// A sandbox device attached to an agent (legacy `Sandbox` model). The backend
// streams these as the agent works; the previewer shows a live VNC feed per
// device. `type` and `status` are kept as plain strings (not z.enum) on
// purpose: they are display-only and the backend may add values — a new
// variant must degrade gracefully (unknown type → generic icon, unknown
// status → no badge) rather than fail the whole `z.array(sandboxSchema)` parse.
export const sandboxSchema = z.object({
  sandboxId: z.string(),
  displayName: z.string().catch(""),
  // emulator | aio | wincua | unknown (AgentSandboxType). Drives the device
  // icon and the take-over interaction (emulator uses postMessage; aio/wincua
  // use an input overlay).
  type: z.string().catch("unknown"),
  // available | assigned | in_use | … — only the first three are surfaced.
  status: z.string().catch(""),
  // The embeddable live-view URL (noVNC / remote screen) shown in the iframe.
  vncUrl: z.string().catch(""),
});
export type Sandbox = z.infer<typeof sandboxSchema>;

// `GET /sandbox/instance?instanceId=` → `{ items: Sandbox[] }`. A malformed row
// degrades to a skipped entry via the per-field `.catch`es above; the list
// itself defaults to empty so one bad row never blanks the device list.
export const sandboxInstanceDataSchema = z.object({
  items: z.array(sandboxSchema).catch([]),
});

// The only device-type value the code branches on: `emulator` takes the
// postMessage take-over path, everything else the aio/wincua input-overlay path.
// Compared against the resilient `type` string above.
export const SandboxType = {
  emulator: "emulator",
} as const;

// Statuses that count as a live, showable device (legacy `VALID_STATUSES`).
// Typed `readonly string[]` (not `as const`): the values are matched against an
// arbitrary lowercased wire `status`, so the element type must stay `string` —
// a `readonly [...]` literal tuple would reject `.includes(status)`.
export const SANDBOX_VISIBLE_STATUSES: readonly string[] = [
  "available",
  "assigned",
  "in_use",
];
