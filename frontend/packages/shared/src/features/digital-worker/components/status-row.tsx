import type * as React from "react";

// A single non-interactive row rendered inside a Select popover for the
// loading / error / empty states of the Add DW selects.
export function StatusRow({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="text-foreground-tertiary flex items-center gap-2 px-3 py-2 text-sm">
      {children}
    </div>
  );
}
