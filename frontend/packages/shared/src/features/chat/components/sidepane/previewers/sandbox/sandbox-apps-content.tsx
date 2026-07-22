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

import { Tabs, TabsList, TabsTrigger } from "@sico/ui";
import { type JSX, useMemo, useState } from "react";

import { AppsTable } from "./apps-table";
import { InstallAppButton } from "./install-app-button";
import { ManageAppsHeader } from "./manage-apps-header";
import { UninstallConfirmDialog } from "./uninstall-confirm-dialog";
import { useAppInstallActions } from "../../../../../sandbox/hooks/use-app-install-actions";
import { useEmulatorAppsQuery } from "../../../../../sandbox/hooks/use-emulator-apps-query";
import { type EmulatorApp } from "../../../../../sandbox/schemas/emulator-app";
import { type Sandbox } from "../../../../../sandbox/schemas/sandbox";

export type SandboxAppsContentProps = {
  agentInstanceId: number;
  // The live device list (from the previewer's instances query) — drives the
  // device tabs + the install/uninstall scope.
  devices: Sandbox[];
  onBack: () => void;
};

type PendingUninstall = { app: EmulatorApp; forAllDevices: boolean };

/**
 * Suspending body of the manage-apps panel: reads `useEmulatorAppsQuery` (which
 * suspends on first fetch and throws to the shell's boundary), then renders the
 * per-device app table with install (.apk upload) and uninstall. Device tabs
 * switch which device's apps show; install/uninstall scope ("this device" vs
 * "all") rides the tab + the chosen menu option.
 */
export function SandboxAppsContent({
  agentInstanceId,
  devices,
  onBack,
}: SandboxAppsContentProps): JSX.Element {
  const query = useEmulatorAppsQuery(agentInstanceId);
  const actions = useAppInstallActions(agentInstanceId);

  const allSandboxIds = useMemo(
    () => devices.map((d) => d.sandboxId),
    [devices],
  );
  const [currentSandboxId, setCurrentSandboxId] = useState<string>(
    devices[0]?.sandboxId ?? "",
  );
  // The selected tab can go stale: the device list is re-polled every 5s and
  // the selected device may drop out. Reconcile at render — fall back to the
  // first surviving device so the panel never strands on a vanished device's
  // empty state (once only one device remains the tabs are gone, so there'd be
  // no in-panel recovery).
  const activeSandboxId = devices.some((d) => d.sandboxId === currentSandboxId)
    ? currentSandboxId
    : (devices[0]?.sandboxId ?? "");
  const [pendingUninstall, setPendingUninstall] =
    useState<PendingUninstall | null>(null);

  // Apps for the device tab in view. The query returns per-device results; pick
  // the current device's set (empty if it has none / isn't in the payload yet).
  // Drop nameless rows: the backend includes system apps with a blank appName
  // that can't be meaningfully shown or acted on (legacy parity — SandboxApps
  // filtered these out before rendering).
  const currentApps = useMemo<EmulatorApp[]>(() => {
    const device = query.data.find((d) => d.sandboxId === activeSandboxId);
    return (device?.apps ?? []).filter((app) => app.appName.length > 0);
  }, [query.data, activeSandboxId]);

  const deviceIds = { current: activeSandboxId, all: allSandboxIds };

  const confirmUninstall = (): void => {
    if (!pendingUninstall) {
      return;
    }
    const { app, forAllDevices } = pendingUninstall;
    setPendingUninstall(null);
    actions.runUninstall(app, forAllDevices, deviceIds);
  };

  return (
    <div className="bg-surface-basic flex h-full flex-col">
      <ManageAppsHeader onBack={onBack} />

      <div className="flex min-h-0 flex-1 flex-col gap-4 px-11 py-6">
        <h2 className="text-foreground-primary text-3xl font-medium">
          All Apps
        </h2>
        <div className="flex items-center justify-between gap-2">
          {devices.length > 1 ? (
            <Tabs value={activeSandboxId} onValueChange={setCurrentSandboxId}>
              <TabsList>
                {devices.map((device) => (
                  <TabsTrigger key={device.sandboxId} value={device.sandboxId}>
                    {device.displayName}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ) : (
            <span />
          )}
          <InstallAppButton
            deviceCount={devices.length}
            disabled={actions.installPending}
            onInstall={(file, scope) =>
              actions.runInstall(file, scope, deviceIds)
            }
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <AppsTable
            apps={currentApps}
            hasMultipleDevices={devices.length > 1}
            onUninstall={(app, forAllDevices) =>
              setPendingUninstall({ app, forAllDevices })
            }
          />
        </div>
      </div>

      <UninstallConfirmDialog
        open={pendingUninstall !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingUninstall(null);
          }
        }}
        forAllDevices={pendingUninstall?.forAllDevices ?? false}
        onConfirm={confirmUninstall}
        pending={actions.uninstallPending}
      />
    </div>
  );
}
