// Public surface of the sandbox device-previewer feature. The chat sidepane
// mounts the thin shells (SandboxInstance / SandboxPreviewer) which compose
// these pieces; everything a consumer outside the feature needs is re-exported
// here. Mirrors the file-preview barrel's explicit named+type style.

export { SandboxList, type SandboxListProps } from "./components/sandbox-list";
export {
  SandboxThumbnail,
  type SandboxThumbnailProps,
} from "./components/sandbox-thumbnail";
export {
  SandboxStatus,
  type SandboxStatusProps,
} from "./components/sandbox-status";
export {
  SandboxDropdown,
  type SandboxDropdownProps,
} from "./components/sandbox-dropdown";
export {
  DeviceScreen,
  type DeviceScreenProps,
} from "./components/device-screen";
export { iconForSandboxType } from "./components/sandbox-icon";

export { useTakeOver, type UseTakeOver } from "./hooks/use-take-over";
export {
  useSandboxInstancesQuery,
  sandboxInstancesQueryOptions,
} from "./hooks/use-sandbox-instances-query";

export {
  type Sandbox,
  sandboxSchema,
  sandboxInstanceDataSchema,
  SandboxType,
  SANDBOX_VISIBLE_STATUSES,
} from "./schemas/sandbox";
export { fetchSandboxInstances } from "./services/sandbox";

export { safeVncUrl } from "./utils/safe-vnc-url";
