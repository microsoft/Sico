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

import { cn } from "@sico/ui/lib/utils.ts";
import type { ReactElement } from "react";

import { type AgentStatus, AgentStatusSchema } from "../schemas/agent";

// The three visual tones a status maps to. Each is the sico text-colour
// token shared by the dot (`bg-current`) and the label — no fill, mirroring
// dwp's `StatusTag appearance="subtle"`.
const TONE_CLASS = {
  success: "text-status-success-foreground",
  info: "text-status-info-foreground",
  muted: "text-foreground-tertiary",
} as const;

export type StatusTone = keyof typeof TONE_CLASS;

export type DwStatusIndicatorProps = {
  tone: StatusTone;
  label: string;
};

// AgentStatus → {tone, label}. Onboarding-saved collapses to Onboarding;
// NEW reads as Active (it also gets the "new" dot on the card).
export const STATUS_INDICATOR: Record<AgentStatus, DwStatusIndicatorProps> = {
  [AgentStatusSchema.enum.ACTIVE]: { tone: "success", label: "Active" },
  [AgentStatusSchema.enum.NEW]: { tone: "success", label: "Active" },
  [AgentStatusSchema.enum.ONBOARDING]: { tone: "info", label: "Onboarding" },
  [AgentStatusSchema.enum.ONBOARDING_SAVED]: {
    tone: "info",
    label: "Onboarding",
  },
  [AgentStatusSchema.enum.INACTIVE]: { tone: "muted", label: "Inactive" },
  [AgentStatusSchema.enum.ABORTED]: { tone: "muted", label: "Aborted" },
  [AgentStatusSchema.enum.UNKNOWN]: { tone: "info", label: "Unknown" },
};

/**
 * A digital worker's lifecycle status as a same-colour dot + label on a
 * transparent background (dwp's `StatusTag appearance="subtle"`). Pure
 * presentation: the caller maps a status to `{tone, label}` (via
 * `STATUS_INDICATOR`) and owns gating + positioning.
 */
export function DwStatusIndicator({
  tone,
  label,
}: DwStatusIndicatorProps): ReactElement {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 text-xs leading-4 font-medium",
        TONE_CLASS[tone],
      )}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      {label}
    </span>
  );
}
