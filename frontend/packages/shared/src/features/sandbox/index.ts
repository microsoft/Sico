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
