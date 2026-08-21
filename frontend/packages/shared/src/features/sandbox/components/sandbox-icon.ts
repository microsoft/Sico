import { Monitor, Smartphone } from "lucide-react";

import { type FileTypeIcon } from "../../../utils/file-icon";
import { SandboxType } from "../schemas/sandbox";

// The device-type glyph: a phone for an emulator, a monitor for everything else
// (aio / wincua / unknown). Shared by the grid card and the instance header so
// the two never disagree.
export function iconForSandboxType(type: string): FileTypeIcon {
  return type === SandboxType.emulator ? Smartphone : Monitor;
}
