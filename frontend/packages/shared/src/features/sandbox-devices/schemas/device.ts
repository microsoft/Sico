import { z } from "zod";

// A sandbox device as listed on the project SANDBOX page. The wire item
// (`GET /sandbox/list`) is snake_case; every field is renamed to camelCase at
// this boundary so consumers never see wire casing. `type` and `status` stay
// plain strings (not `z.enum`): they are display/grouping values and the
// backend may add variants — a new one must degrade (unknown group, no badge)
// rather than fail the whole parse.
export const deviceSchema = z
  .object({
    sandbox_id: z.string(),
    display_name: z.string().catch(""),
    type: z.string().catch("unknown"),
    // available | assigned
    status: z.string().catch(""),
    project_id: z.number().int(),
    // 0 / "" when unassigned.
    instance_id: z.number().int().catch(0),
    instance_name: z.string().catch(""),
    vnc_url: z.string().catch(""),
  })
  .transform((d) => ({
    sandboxId: d.sandbox_id,
    displayName: d.display_name,
    type: d.type,
    status: d.status,
    projectId: d.project_id,
    instanceId: d.instance_id,
    instanceName: d.instance_name,
    vncUrl: d.vnc_url,
  }));
export type Device = z.infer<typeof deviceSchema>;

// `GET /sandbox/list` returns `data` as an OBJECT keyed by device type, each
// value an array of wire items: `{aio:[], emulator:[], physical:[], wincua:[]}`.
// Each bucket is optional + `.catch([])` so a missing/malformed group degrades
// to empty rather than nuking the whole response.
const deviceGroup = z.array(deviceSchema).catch([]);
export const deviceListDataSchema = z.object({
  aio: deviceGroup.optional(),
  emulator: deviceGroup.optional(),
  physical: deviceGroup.optional(),
  wincua: deviceGroup.optional(),
});
export type DeviceListData = z.infer<typeof deviceListDataSchema>;

// The known device-type buckets, in display order.
export const DEVICE_TYPES = ["aio", "emulator", "physical", "wincua"] as const;

// Flatten the dict-of-arrays into a single `Device[]` — each device already
// carries its own `type`, so grouping can be re-derived downstream.
export function flattenDeviceGroups(data: DeviceListData): Device[] {
  return DEVICE_TYPES.flatMap((type) => data[type] ?? []);
}
