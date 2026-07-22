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

import { useState } from "react";
import { z } from "zod";

import {
  ASSETS_HINT_DISMISSED_LS,
  safeGetItemFromLocalStorage,
  safeSetItemToLocalStorage,
} from "../../../utils/local-storage";
import type { AssetCategory } from "../types";

// Only the two derived categories carry a definition hint (§5);
// `all`/`knowledge` never show a banner, so they are absent from the map.
export type HintTab = "deliverable" | "experience";

// Two-part copy (Figma `message bar`, nodes 19475-21695 / 19398-79716): a bold
// label + a regular description, rendered as the in-table hint bar.
export const HINT_COPY: Record<
  HintTab,
  { label: string; description: string }
> = {
  deliverable: {
    label: "Deliverable:",
    description: "Artifacts produced by digital workers.",
  },
  experience: {
    label: "Experience:",
    description: "Reusable patterns accumulated through execution.",
  },
};

// The persisted "don't show again" set — the tabs whose hint was dismissed.
const dismissedHintsSchema = z.array(z.enum(["deliverable", "experience"]));

// The active category's hint copy key, or `null` when the category has no hint
// or it was dismissed. Folds the category-kind check and the dismissed-set check
// into one.
export function resolveHintTab(
  category: AssetCategory,
  dismissed: HintTab[],
): HintTab | null {
  if (category !== "deliverable" && category !== "experience") {
    return null;
  }
  return dismissed.includes(category) ? null : category;
}

// localStorage-backed dismissed-hint set (NOT URL state — it is per-device).
// Read once into state; each dismiss appends the tab and persists.
export function useDismissedHints(): {
  dismissedHints: HintTab[];
  dismissHint: (tab: HintTab) => void;
} {
  const [dismissedHints, setDismissedHints] = useState<HintTab[]>(
    () =>
      safeGetItemFromLocalStorage(
        ASSETS_HINT_DISMISSED_LS,
        dismissedHintsSchema,
      ) ?? [],
  );
  const dismissHint = (tab: HintTab): void => {
    if (dismissedHints.includes(tab)) {
      return;
    }
    // Read `dismissedHints` directly (not a functional updater): the write must
    // live OUTSIDE the updater (updaters must be pure — StrictMode double-invokes
    // them, so a write inside would run twice). A direct read is safe because
    // only ONE hint banner renders at a time (resolveHintTab returns a single
    // tab), so two different dismisses can't race within one tick.
    const next = [...dismissedHints, tab];
    safeSetItemToLocalStorage(
      ASSETS_HINT_DISMISSED_LS,
      dismissedHintsSchema,
      next,
    );
    setDismissedHints(next);
  };
  return { dismissedHints, dismissHint };
}
