import { toast } from "@sico/ui";
import { type MutateOptions } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { InstallError, useInstallApp } from "./use-install-app";
import { useUninstallApp } from "./use-uninstall-app";
import { type EmulatorApp } from "../schemas/emulator-app";

// Which devices an install targets: just the device in view, or every attached
// one. A pure UI discriminant (never crosses a parse boundary), owned here in
// the sandbox layer so the install control can depend inward on it.
export type InstallScope = "current" | "all";

// The current device + the full device set, so an action can target one or all.
export type DeviceScope = { current: string; all: string[] };

// Success copy for an uninstall: names the devices it couldn't clear when an
// "all devices" uninstall was partial, otherwise the plain scoped message.
function uninstallMessage(
  name: string,
  scope: string,
  failedDeviceNames: string[],
): string {
  if (failedDeviceNames.length > 0) {
    return `${name} uninstalled except ${failedDeviceNames.join(", ")}.`;
  }
  return `${name} uninstalled${scope}.`;
}

export type AppInstallActions = {
  installPending: boolean;
  uninstallPending: boolean;
  runInstall: (file: File, scope: InstallScope, ids: DeviceScope) => void;
  runUninstall: (
    app: EmulatorApp,
    forAllDevices: boolean,
    ids: DeviceScope,
  ) => void;
};

// A failure toast's copy: a title (the clamped 2-line headline) and, for a
// multi-device rejection, a description carrying the per-device reasons.
export type InstallErrorToast = { title: string; description?: string };

// Failure copy by phase. `upload` gets dedicated copy. `device` surfaces the
// backend's raw adb reason(s): a single failing device puts its one reason in
// the title (it fits the 2-line card); multiple failing devices can't all fit
// the clamped title, so the title summarises the count and the reasons move to
// the description slot. Reasons join with "; " — the toast renders title and
// description as plain text, so a "\n" would collapse to a space anyway. `start`
// and any non-`InstallError` fall through to the generic message. `aborted`
// never reaches here — the caller dismisses it silently.
export function installErrorMessage(
  error: unknown,
  name: string,
): InstallErrorToast {
  if (error instanceof InstallError) {
    if (error.phase === "upload") {
      return { title: `Couldn't upload ${name}. Please try again.` };
    }
    if (error.phase === "device") {
      const [first, ...rest] = error.deviceReasons;
      if (first === undefined) {
        return { title: `${name} could not be installed on the device.` };
      }
      if (rest.length === 0) {
        return { title: first };
      }
      return {
        title: `Couldn't install ${name} on ${error.deviceReasons.length} devices.`,
        description: error.deviceReasons.join("; "),
      };
    }
  }
  return { title: `Couldn't install ${name}. Please try again.` };
}

// Drive the install failure toast off the phase: a user-driven cancel (panel
// close / agent-instance change) clears the loading toast silently; everything
// else shows a phase-aware message (device rejections carry the raw adb reason).
export function handleInstallError(
  error: unknown,
  name: string,
  toastId: string | number,
): void {
  if (error instanceof InstallError && error.phase === "aborted") {
    toast.dismiss(toastId);
    return;
  }
  const { title, description } = installErrorMessage(error, name);
  toast.error(title, { id: toastId, description });
}

// Loading toasts have Infinity duration, and react-query gates mutate-level
// callbacks behind `hasListeners()` — so if the panel unmounts mid-mutation
// (the common "close the panel" path), onSuccess/onError never fire and the
// "Installing…"/"Uninstalling…" toast orphans on screen forever. This hook
// returns `guard(toastId, opts)`: it records the id, layers an `onSettled` that
// forgets it, and dismisses whatever's still pending on unmount.
function usePendingToastDismiss(): <TData, TVars>(
  toastId: string | number,
  opts: MutateOptions<TData, Error, TVars>,
) => MutateOptions<TData, Error, TVars> {
  const pending = useRef(new Set<string | number>());
  useEffect(() => {
    const ids = pending.current;
    return () => {
      for (const id of ids) {
        toast.dismiss(id);
      }
      ids.clear();
    };
  }, []);
  return (toastId, opts) => {
    pending.current.add(toastId);
    return {
      ...opts,
      onSettled: (...args) => {
        pending.current.delete(toastId);
        opts.onSettled?.(...args);
      },
    };
  };
}

// Install/uninstall orchestration for the manage-apps panel: runs the mutations
// and drives the progress toasts (loading → success/error, updating one toast
// by id). Split out of `SandboxApps` so the panel component stays within the
// function-length budget and the toast wording lives in one place.
export function useAppInstallActions(
  agentInstanceId: number,
): AppInstallActions {
  const install = useInstallApp(agentInstanceId);
  const uninstall = useUninstallApp(agentInstanceId);
  const guard = usePendingToastDismiss();

  const runInstall = (
    file: File,
    scope: InstallScope,
    ids: DeviceScope,
  ): void => {
    const sandboxIds = scope === "all" ? ids.all : [ids.current];
    const name = file.name.replace(/\.apk$/i, "");
    const toastId = toast.loading(`Installing ${name}…`);
    install.mutate(
      { file, sandboxIds },
      guard(toastId, {
        onSuccess: () => toast.success(`${name} installed.`, { id: toastId }),
        onError: (error) => handleInstallError(error, name, toastId),
      }),
    );
  };

  const runUninstall = (
    app: EmulatorApp,
    forAllDevices: boolean,
    ids: DeviceScope,
  ): void => {
    const sandboxIds = forAllDevices ? ids.all : [ids.current];
    const name = app.appName.length > 0 ? app.appName : app.package;
    const scope = forAllDevices ? " from all devices" : "";
    const toastId = toast.loading(`Uninstalling ${name}${scope}…`);
    uninstall.mutate(
      { package: app.package, sandboxIds },
      guard(toastId, {
        onSuccess: ({ failedDeviceNames }) => {
          toast.success(uninstallMessage(name, scope, failedDeviceNames), {
            id: toastId,
          });
        },
        onError: () => toast.error("Uninstall failed.", { id: toastId }),
      }),
    );
  };

  return {
    installPending: install.isPending,
    uninstallPending: uninstall.isPending,
    runInstall,
    runUninstall,
  };
}
