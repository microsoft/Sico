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

import { Badge, type BadgeColor } from "@sico/ui";
import type { ReactElement } from "react";

// Wire status → {label, badge color}. Mirrors legacy `sandboxStatusMap`:
// available/assigned read as "Free" (green), in_use as "Running" (blue), and the
// unhealthy family as "Invalid" (red). Rendered as a `Badge` secondary (text +
// dot), matching `DwStatusIndicator`.
const STATUS_DISPLAY: Record<string, { label: string; color: BadgeColor }> = {
  available: { label: "Free", color: "green" },
  assigned: { label: "Free", color: "green" },
  in_use: { label: "Running", color: "blue" },
  unknown: { label: "Invalid", color: "red" },
  unhealthy: { label: "Invalid", color: "red" },
  unavailable: { label: "Invalid", color: "red" },
};

export type SandboxStatusProps = {
  status: string;
};

/**
 * A sandbox device's status as a `Badge` (Free / Running / Invalid) — secondary
 * variant with a same-colour dot. Pure presentation; an unmapped status renders
 * nothing (the device row simply omits the badge), matching legacy.
 */
export function SandboxStatus({
  status,
}: SandboxStatusProps): ReactElement | null {
  const display = STATUS_DISPLAY[status.toLowerCase()];
  if (!display) {
    return null;
  }
  return (
    <Badge variant="secondary" color={display.color} className="shrink-0">
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      {display.label}
    </Badge>
  );
}
