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

import { toast } from "@sico/ui";
import { useEffect, useRef } from "react";

import { ExtractionStatusSchema } from "../schemas/asset";
import type { AssetRow } from "../types";

const { UPLOADED, INGESTED, FAILED } = ExtractionStatusSchema.enum;

// One toast per finished extraction batch (counts since the last batch).
function emitExtractionToast(ingested: number, failed: number): void {
  if (failed === 0) {
    toast.success(`Extraction complete — ${ingested} added.`);
  } else if (ingested === 0) {
    toast.error(`Extraction failed for ${failed} item(s).`);
  } else {
    toast.error(`Extraction finished — ${ingested} added, ${failed} failed.`);
  }
}

// A stable fingerprint of the knowledge docs' (id, status), so the watcher
// effect re-runs only when a status actually changes — not on every unrelated
// re-render (search keystrokes etc.), where `rows` is a fresh array each time.
function statusKey(rows: readonly AssetRow[]): string {
  return rows
    .filter((row) => row.type === "knowledge")
    .map((row) => `${row.id}:${row.status}`)
    .join(",");
}

// Registration only queues extraction; the real result lands later via the
// 5s poll. This watches each Knowledge doc's status and, once NO row is still
// UPLOADED (the batch settled), fires ONE summary toast for everything that
// transitioned UPLOADED → INGESTED/FAILED since the last summary. The first
// pass seeds the snapshot with no prior status, so already-settled history rows
// never count — only docs actually observed leaving UPLOADED do.
export function useExtractionResultToast(rows: readonly AssetRow[]): void {
  const prevStatus = useRef(new Map<number, number>());
  const pending = useRef({ ingested: 0, failed: 0 });
  const key = statusKey(rows);
  useEffect(() => {
    const docs = rows.filter((row) => row.type === "knowledge");
    const prev = prevStatus.current;
    for (const doc of docs) {
      const was = prev.get(doc.id);
      if (was === UPLOADED && doc.status === INGESTED) {
        pending.current.ingested += 1;
      } else if (was === UPLOADED && doc.status === FAILED) {
        pending.current.failed += 1;
      }
    }
    prevStatus.current = new Map(docs.map((doc) => [doc.id, doc.status]));
    const anyUploading = docs.some((doc) => doc.status === UPLOADED);
    const { ingested, failed } = pending.current;
    if (!anyUploading && ingested + failed > 0) {
      emitExtractionToast(ingested, failed);
      pending.current = { ingested: 0, failed: 0 };
    }
    // Keyed on the status fingerprint, not the `rows` array identity (M4).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `rows` is read but the effect is intentionally gated on the status fingerprint
  }, [key]);
}
