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
