/**
 * Copyright (c) 2026 Sico Authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { emulatorAppsQueryKey } from "./use-emulator-apps-query";
import { useApiClient } from "../../../services/api-client-context";
import { logger } from "../../../utils/logger";
import { uploadProjectAssetDirect } from "../../chat/services/upload";
import {
  APP_INSTALL_TASK_STATUS,
  APP_OP_STATUS,
} from "../schemas/emulator-app";
import {
  getInstallTaskStatus,
  installEmulatorApps,
} from "../services/emulator-apps";

const POLL_INTERVAL_MS = 2000;

type InstallVars = {
  file: File;
  sandboxIds: string[];
};

// Which stage of the install flow failed. Lets the toast tell "upload failed"
// apart from "the device rejected the apk" (they were both a generic "Install
// failed" before). `aborted` is a user-driven cancel (panel close / agent-
// instance change), which the caller reports silently rather than as an error.
export type InstallPhase = "upload" | "start" | "device" | "aborted";

// A typed failure carrying the stage and, for a device rejection, the raw adb
// reason per device (e.g. `INSTALL_FAILED_VERSION_DOWNGRADE`) so the toast can
// surface WHY instead of a blanket message.
export class InstallError extends Error {
  readonly phase: InstallPhase;
  readonly deviceReasons: string[];

  constructor(
    phase: InstallPhase,
    message: string,
    deviceReasons: string[] = [],
  ) {
    super(message);
    this.name = "InstallError";
    this.phase = phase;
    this.deviceReasons = deviceReasons;
  }
}

// The outcome of polling: `ok: true` on success; on a terminal failure, whether
// it was a user-driven cancel (`aborted`) and the raw per-device adb reasons
// (already named with the device) for the toast.
type PollOutcome =
  | { ok: true }
  | { ok: false; aborted: boolean; deviceReasons: string[] };

// Read `signal.aborted` through a call boundary. TS narrows the property to
// `false` after the top-of-loop guard and (a known limitation) doesn't reset
// that narrowing across the intervening `await`, so a direct re-read in the
// catch is flagged as always-falsy dead code — yet the flag genuinely flips
// mid-await when the user cancels. The indirection defeats the stale narrowing.
function isSignalAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

// Poll the install task until it reaches a terminal state. Cancellable via
// `signal` (panel close / agent-instance change) — the loop bails the moment
// it's aborted, and the abort also cancels the in-flight status request, so a
// stale install can't keep polling after the user has moved on. On terminal
// failure it returns the per-device adb reasons so the caller can report WHY.
async function pollInstallTask(
  apiClient: ReturnType<typeof useApiClient>,
  taskId: string,
  signal: AbortSignal,
): Promise<PollOutcome> {
  for (;;) {
    if (isSignalAborted(signal)) {
      return { ok: false, aborted: true, deviceReasons: [] };
    }
    let taskStatus: Awaited<ReturnType<typeof getInstallTaskStatus>>;
    try {
      taskStatus = await getInstallTaskStatus(apiClient, taskId, signal);
    } catch (error) {
      // An abort landing WHILE the GET is in flight doesn't reject with a
      // recognisable cancel: the axios interceptor turns the cancelled request
      // into a synthetic network envelope, so `unwrapData` throws a plain
      // ZodError. Re-check the signal to tell that cancel apart from a genuine
      // parse/transport failure, so the caller dismisses it silently instead of
      // showing "Couldn't install".
      if (isSignalAborted(signal)) {
        return { ok: false, aborted: true, deviceReasons: [] };
      }
      throw error;
    }
    const { status, deviceFailures } = taskStatus;
    if (status === APP_INSTALL_TASK_STATUS.success) {
      return { ok: true };
    }
    if (
      status === APP_INSTALL_TASK_STATUS.pending ||
      status === APP_INSTALL_TASK_STATUS.running ||
      status === APP_INSTALL_TASK_STATUS.partial
    ) {
      // Not terminal yet — keep waiting.
      await new Promise((resolve) => {
        setTimeout(resolve, POLL_INTERVAL_MS);
      });
      continue;
    }
    // `error` or any unrecognised status → terminal failure. Name each device
    // with its adb reason; fall back to a bare "install failed" when the reason
    // is absent (or whitespace-only) so the toast still says which device
    // rejected the apk.
    const deviceReasons = deviceFailures.map(
      (d) =>
        `${d.displayName || "Device"}: ${d.errorMessage.trim() || "install failed"}`,
    );
    logger.error("[install] task failed", { taskId, status, deviceReasons });
    return { ok: false, aborted: false, deviceReasons };
  }
}

// The full install flow: upload → kick off install → poll to completion. Throws
// an `InstallError` tagged with the failing phase (and, for a device rejection,
// the raw adb reasons) so the mutation's onError drives a phase-aware toast.
export async function runInstallFlow(
  apiClient: ReturnType<typeof useApiClient>,
  { file, sandboxIds }: InstallVars,
  signal: AbortSignal,
): Promise<void> {
  let asset: Awaited<ReturnType<typeof uploadProjectAssetDirect>>;
  try {
    asset = await uploadProjectAssetDirect(apiClient, file, signal);
  } catch (error) {
    if (signal.aborted) {
      throw new InstallError("aborted", "Install cancelled");
    }
    logger.error("[install] upload failed", { error });
    throw new InstallError("upload", "Upload failed");
  }
  if (asset.sasUrl === undefined) {
    throw new InstallError("upload", "Upload returned no URL");
  }

  const started = await installEmulatorApps(apiClient, {
    sandboxIds,
    url: asset.sasUrl,
  });
  if (started.status !== APP_OP_STATUS.pending || started.taskId.length === 0) {
    logger.error("[install] task did not start", {
      status: started.status,
      taskId: started.taskId,
    });
    throw new InstallError("start", "Install did not start");
  }

  const outcome = await pollInstallTask(apiClient, started.taskId, signal);
  if (outcome.ok) {
    return;
  }
  if (outcome.aborted) {
    throw new InstallError("aborted", "Install cancelled");
  }
  throw new InstallError(
    "device",
    outcome.deviceReasons[0] ?? "Install failed",
    outcome.deviceReasons,
  );
}

// The hook owns an AbortController that a cleanup effect aborts on unmount /
// instance change, so an in-flight install stops polling once the panel closes;
// success invalidates the apps query to refresh the list.
export function useInstallApp(
  instanceId: number,
): ReturnType<typeof useMutation<void, Error, InstallVars>> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const controllerRef = useRef<AbortController>(new AbortController());

  // Abort any in-flight install when the panel unmounts or switches instance,
  // then re-arm the controller so a later install on a remounted panel isn't
  // born already-aborted.
  useEffect(() => {
    const controller = controllerRef.current;
    return () => {
      controller.abort();
      controllerRef.current = new AbortController();
    };
  }, [instanceId]);

  return useMutation<void, Error, InstallVars>({
    mutationFn: (vars: InstallVars): Promise<void> =>
      runInstallFlow(apiClient, vars, controllerRef.current.signal),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: emulatorAppsQueryKey(instanceId),
      });
    },
  });
}
