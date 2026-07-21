import { useEffect, useState } from "react";

import type { LoginMode } from "../../../components/shell/login-mode-context";

// Mirrors `--animate-login-exit`'s 150ms duration (globals.css): the
// `prefers-reduced-motion` safety net below must commit the swap on the same
// clock as the exit animation it stands in for — not a looser magic number.
const EXIT_DURATION_MS = 150;

// Drives dwp's `AnimatePresence mode="wait"` with plain state: `displayedMode`
// trails `mode` for one exit cycle. `sync()` (called on the form's
// `animationend`) commits the swap; the effect is a `prefers-reduced-motion`
// safety net since no animationend fires when the exit is suppressed.
export function useExitSwap(mode: LoginMode): {
  displayedMode: LoginMode;
  exiting: boolean;
  sync: () => void;
} {
  const [displayedMode, setDisplayedMode] = useState<LoginMode>(mode);
  const exiting = displayedMode !== mode;
  useEffect(() => {
    if (!exiting) {
      return undefined;
    }
    const id = setTimeout(() => setDisplayedMode(mode), EXIT_DURATION_MS);
    return () => clearTimeout(id);
  }, [exiting, mode]);
  return { displayedMode, exiting, sync: () => setDisplayedMode(mode) };
}
