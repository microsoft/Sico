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

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, type RenderHookResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";

import {
  uploadingKey,
  useAssetsPoll,
} from "@/features/projects/hooks/use-assets-poll";
import { ExtractionStatusSchema } from "@/features/projects/schemas/asset";
import type { AssetCategory, AssetRow } from "@/features/projects/types";

const status = ExtractionStatusSchema.enum;

const KNOWLEDGE_KEY = ["projects", "assets", 1, "knowledge"];

function makeKnowledge(partial: Partial<AssetRow> = {}): AssetRow {
  return {
    type: "knowledge",
    id: 10,
    name: "spec.pdf",
    documentType: 1,
    status: status.UPLOADED,
    failReason: null,
    tags: [],
    assetId: 99,
    sourceFile: "spec.pdf",
    linkUrl: null,
    createdAt: 1_700_000_000_000,
    creator: { kind: "user", username: "alice" },
    ...partial,
  } as AssetRow;
}

// Render `useAssetsPoll` against a real QueryClient whose `invalidateQueries` is
// spied — the poll fires `invalidateQueries(listKey)` on its 5s cadence (it no
// longer refetches from inside the query), so the spy is the observable signal.
function renderPoll(
  category: AssetCategory,
  rows: AssetRow[],
): RenderHookResult<void, { rows: AssetRow[] }> & {
  invalidate: MockInstance;
} {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = vi
    .spyOn(queryClient, "invalidateQueries")
    .mockResolvedValue(undefined);

  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  const view = renderHook(
    ({ rows: r }: { rows: AssetRow[] }) => useAssetsPoll(1, category, r),
    { wrapper: Wrapper, initialProps: { rows } },
  );
  return { invalidate, ...view };
}

describe("useAssetsPoll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("invalidates the list key every 5s while a knowledge row is UPLOADED", async () => {
    const { invalidate } = renderPoll("knowledge", [makeKnowledge()]);

    expect(invalidate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);

    expect(invalidate).toHaveBeenCalledWith({ queryKey: KNOWLEDGE_KEY });
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("stops polling once every row has settled", async () => {
    const { invalidate, rerender } = renderPoll("knowledge", [makeKnowledge()]);

    await vi.advanceTimersByTimeAsync(5000);
    expect(invalidate).toHaveBeenCalledTimes(1);

    // A poll tick settled the row (INGESTED) → the uploading set empties → the
    // effect tears the interval down, so no further invalidations fire.
    rerender({ rows: [makeKnowledge({ status: status.INGESTED })] });
    invalidate.mockClear();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("stops polling at the 2-minute ceiling even if the row never settles", async () => {
    const { invalidate } = renderPoll("knowledge", [makeKnowledge()]);

    // A row stuck UPLOADED would poll forever without the wall-clock ceiling;
    // past 120s the run is abandoned, so the call count freezes.
    await vi.advanceTimersByTimeAsync(130_000);
    const atCeiling = invalidate.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);

    expect(invalidate.mock.calls.length).toBe(atCeiling);
  });

  it("does not poll the deliverable category (no extraction status there)", async () => {
    const deliverable = {
      type: "deliverable",
      id: 7,
      name: "report.md",
      createdAt: 1_700_000_002_000,
      fileSasUrl: "https://sas/report.md",
      creator: { kind: "agent", agentInstanceId: 42, agentName: "Max" },
    } as AssetRow;
    const { invalidate } = renderPoll("deliverable", [deliverable]);

    await vi.advanceTimersByTimeAsync(15_000);

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("does not start an interval when nothing is uploading", async () => {
    const { invalidate } = renderPoll("knowledge", [
      makeKnowledge({ status: status.INGESTED }),
    ]);

    await vi.advanceTimersByTimeAsync(15_000);

    expect(invalidate).not.toHaveBeenCalled();
  });
});

// The poll-run identity (I1 regression): a run is keyed on the uploading-id SET,
// so a new upload after the ceiling gets a fresh window instead of inheriting an
// expired single wall-clock start. Only KNOWLEDGE rows carry a pollable status;
// playbooks / deliverables have none, so they never extend the window.
describe("uploadingKey", () => {
  const UPLOADED = status.UPLOADED;
  const INGESTED = status.INGESTED;

  it("is stable regardless of row order (same run)", () => {
    const a = uploadingKey([
      { type: "knowledge", id: 11, status: UPLOADED },
      { type: "knowledge", id: 10, status: UPLOADED },
    ]);
    const b = uploadingKey([
      { type: "knowledge", id: 10, status: UPLOADED },
      { type: "knowledge", id: 11, status: UPLOADED },
    ]);
    expect(a).toBe(b);
  });

  it("changes when a new upload joins the set (new run)", () => {
    const before = uploadingKey([
      { type: "knowledge", id: 10, status: UPLOADED },
    ]);
    const after = uploadingKey([
      { type: "knowledge", id: 10, status: UPLOADED },
      { type: "knowledge", id: 11, status: UPLOADED },
    ]);
    expect(after).not.toBe(before);
  });

  it("ignores settled rows and is empty when nothing is uploading", () => {
    expect(
      uploadingKey([
        { type: "knowledge", id: 10, status: INGESTED },
        { type: "knowledge", id: 11, status: UPLOADED },
      ]),
    ).toBe("11");
    expect(
      uploadingKey([{ type: "knowledge", id: 10, status: INGESTED }]),
    ).toBe("");
    expect(uploadingKey([])).toBe("");
  });

  it("never counts a non-knowledge row (playbook / deliverable have no status)", () => {
    expect(
      uploadingKey([
        { type: "experience", id: 5 },
        { type: "deliverable", id: 7 },
        { type: "knowledge", id: 10, status: UPLOADED },
      ]),
    ).toBe("10");
  });
});
