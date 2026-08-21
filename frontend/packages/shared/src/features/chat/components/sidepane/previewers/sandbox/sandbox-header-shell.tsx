import { MonitorSmartphone } from "lucide-react";
import { type JSX } from "react";

import { SidepaneHeader } from "../../sidepane-header";

// Header-only chrome reused by the previewer's loading / error states (the list
// and instance views render their own header). Keeps those states aligned with
// the previewer's framing instead of a bare centered spinner.
export function SandboxHeaderShell({
  children,
}: {
  children: JSX.Element;
}): JSX.Element {
  return (
    <div className="bg-surface-basic flex h-full flex-col">
      <SidepaneHeader icon={MonitorSmartphone} title="Device" />
      {children}
    </div>
  );
}
