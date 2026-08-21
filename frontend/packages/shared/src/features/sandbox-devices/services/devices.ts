import type { AxiosInstance } from "axios";
import { z } from "zod";

import { apiResponseSchema, assertOk, unwrapData } from "../../../schemas/api";
import {
  type Device,
  deviceListDataSchema,
  flattenDeviceGroups,
} from "../schemas/device";

// `GET /sandbox/list?projectId=<id>` → the sandboxes bound to this project,
// grouped by type. The backend scopes the pool to the project (a sandbox must be
// org→project assigned before it can be bound to a DW), so the page/drawer only
// ever see this project's devices. Parse the dict-of-arrays, then flatten to a
// flat `Device[]` (each device carries its own `type` for re-grouping).
const listEnvelope = apiResponseSchema(deviceListDataSchema);

export async function fetchDevices(
  client: AxiosInstance,
  projectId: number,
): Promise<Device[]> {
  const res = await client.get<unknown>("/sandbox/list", {
    params: { projectId },
  });
  const data = unwrapData(listEnvelope.parse(res.data), "fetchDevices");
  return flattenDeviceGroups(data);
}

// `POST /sandbox/assign` binds a device to a Digital Worker instance. The body
// is snake_case per the backend contract. A non-OK `code` inside an HTTP-200
// envelope (e.g. permission denial) must reject — axios resolves the 200, so
// assert on the envelope code itself.
export type AssignDeviceInput = {
  instanceId: string;
  sandboxId: string;
};

export async function assignDevice(
  client: AxiosInstance,
  { instanceId, sandboxId }: AssignDeviceInput,
): Promise<void> {
  const res = await client.post<unknown>("/sandbox/assign", {
    instance_id: instanceId,
    sandbox_id: sandboxId,
  });
  assertOk(apiResponseSchema(z.unknown()).parse(res.data), "assignDevice");
}
