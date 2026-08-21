import { z } from "zod";

// A single app installed on an emulator device. `appName`/`version` degrade to
// "" and `package` (the stable identity + uninstall key) is required — a row
// without a package can't be acted on, so the whole row is dropped rather than
// rendered un-actionable.
export const emulatorAppSchema = z.object({
  appName: z.string().catch(""),
  package: z.string(),
  version: z.string().catch(""),
});
export type EmulatorApp = z.infer<typeof emulatorAppSchema>;

// One device's app set in a list response. A malformed app row (e.g. missing
// `package`) is dropped individually — each element degrades to `null` and is
// filtered out — so one bad entry never blanks the device's whole list.
export const emulatorAppsDeviceResultSchema = z.object({
  sandboxId: z.string(),
  displayName: z.string().catch(""),
  apps: z
    .array(emulatorAppSchema.nullable().catch(null))
    .catch([])
    .transform((rows) =>
      rows.filter((row): row is EmulatorApp => row !== null),
    ),
});
export type EmulatorAppsDeviceResult = z.infer<
  typeof emulatorAppsDeviceResultSchema
>;

// `POST /sandbox/emulator/apps/list` → per-device app sets. `results` defaults
// to empty so a shape drift never throws the whole query.
export const listEmulatorAppsDataSchema = z.object({
  results: z.array(emulatorAppsDeviceResultSchema).catch([]),
});

// Install/uninstall status values the flow branches on. Kept as plain strings
// (not a strict z.enum) — the values are wire-driven and the backend may add
// states. Parsed resiliently (lowercased, defaulting to ""), and compared
// against these constants at the call site (mirrors `sandbox.ts`'s `status`).
export const APP_OP_STATUS = {
  pending: "pending",
  success: "success",
  failed: "failed",
  partial: "partial",
} as const;

// Lowercased wire string; an unrecognised/missing value degrades to "" (treated
// as not-success) rather than failing the parse.
const wireStatusSchema = z
  .string()
  .catch("")
  .transform((s) => s.toLowerCase());

// `POST /sandbox/emulator/apps/install` → a pending task to poll. `pending` +
// a `taskId` means "started"; anything else is an immediate failure.
export const installEmulatorAppsDataSchema = z.object({
  status: wireStatusSchema,
  taskId: z.string().catch(""),
});

// Async install task status. `success` is terminal-OK; `error` is terminal-
// fail; `pending`/`running`/`partial` keep polling.
export const APP_INSTALL_TASK_STATUS = {
  pending: "pending",
  running: "running",
  success: "success",
  partial: "partial",
  error: "error",
} as const;

// One device's install outcome inside a task's `result.results[]`. The backend
// carries the raw adb failure here (e.g. `INSTALL_FAILED_VERSION_DOWNGRADE`);
// `displayName` names the device for the failure toast. All fields degrade so a
// shape drift on the error path never throws instead of surfacing the reason.
export const installDeviceResultSchema = z.object({
  displayName: z.string().catch(""),
  status: wireStatusSchema,
  errorMessage: z.string().catch(""),
});
export type InstallDeviceResult = z.infer<typeof installDeviceResultSchema>;

// `GET /sandbox/emulator/apps/tasks/{taskId}` → the polled install task. `result`
// is present once the task reaches a terminal state and carries the per-device
// outcomes; it's optional (absent while pending/running) and fully lenient so a
// missing/renamed/wrong-typed field degrades to "no detail" rather than failing
// the poll parse (which would mask the real error as a generic failure). The
// outer `.catch(undefined)` covers a present-but-non-object `result` (e.g. `[]`
// or a string) that `.nullish()` alone would let throw; the per-element
// `.nullable().catch(null)` + filter keeps the valid device reasons when one
// sibling row is malformed (mirrors `emulatorAppsDeviceResultSchema`).
export const installTaskStatusDataSchema = z.object({
  status: wireStatusSchema,
  result: z
    .object({
      results: z
        .array(installDeviceResultSchema.nullable().catch(null))
        .catch([])
        .transform((rows) =>
          rows.filter((row): row is InstallDeviceResult => row !== null),
        ),
    })
    .nullish()
    .catch(undefined),
});

// One device's uninstall outcome (multi-device uninstall). `uninstalled` is the
// per-device success value; anything else means that device kept the app.
export const uninstallDeviceResultSchema = z.object({
  sandboxId: z.string().catch(""),
  displayName: z.string().catch(""),
  status: z
    .string()
    .transform((s) => s.toLowerCase())
    .catch(""),
});
export type UninstallDeviceResult = z.infer<typeof uninstallDeviceResultSchema>;

// `POST /sandbox/emulator/apps/uninstall` → overall status + per-device results
// (used to name the devices an "uninstall from all" couldn't clear).
export const uninstallEmulatorAppsDataSchema = z.object({
  status: wireStatusSchema,
  results: z.array(uninstallDeviceResultSchema).catch([]),
});
