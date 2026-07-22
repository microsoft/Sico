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
import { renderHook } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { useSkillStatusSync } from "@/features/skill/hooks/use-skill-status-sync";
import type { SkillItem } from "@/features/skill/schemas/skill";
import { SkillStatusSchema } from "@/features/skill/schemas/skill";

// The status query is the boundary we control here: each test drives its
// `data`/`isExhausted` return so we can assert how the sync hook maps a polling
// outcome onto `onSettled`, without spinning real 5s poll intervals.
const statusQuery = vi.hoisted(() => ({
  current: {
    data: undefined as number | undefined,
    isExhausted: false,
  },
}));

vi.mock("@/features/skill/hooks/use-skill-status-query", () => ({
  useSkillStatusQuery: () => statusQuery.current,
}));

function wrapper({ children }: { children: ReactNode }): ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const skill = { id: 1, version: "v1" } as SkillItem;

describe("useSkillStatusSync", () => {
  it("reports UPLOADED when the parse succeeds", () => {
    statusQuery.current = {
      data: SkillStatusSchema.enum.UPLOADED,
      isExhausted: false,
    };
    const onSettled = vi.fn();
    renderHook(
      () =>
        useSkillStatusSync({ skill, version: "v1", parsing: true, onSettled }),
      { wrapper },
    );
    expect(onSettled).toHaveBeenCalledWith(SkillStatusSchema.enum.UPLOADED);
  });

  it("reports FAILED when the parse fails", () => {
    statusQuery.current = {
      data: SkillStatusSchema.enum.FAILED,
      isExhausted: false,
    };
    const onSettled = vi.fn();
    renderHook(
      () =>
        useSkillStatusSync({ skill, version: "v1", parsing: true, onSettled }),
      { wrapper },
    );
    expect(onSettled).toHaveBeenCalledWith(SkillStatusSchema.enum.FAILED);
  });

  it("reports FAILED when polling is exhausted while still uploading", () => {
    // The deadlock case: polling gave up at the attempt cap but status never
    // left UPLOADING. Without a terminal signal the card stays stuck on
    // "Parsing …" forever and hides every control. Exhaustion must settle as
    // FAILED so the card leaves the parsing state.
    statusQuery.current = {
      data: SkillStatusSchema.enum.UPLOADING,
      isExhausted: true,
    };
    const onSettled = vi.fn();
    renderHook(
      () =>
        useSkillStatusSync({ skill, version: "v1", parsing: true, onSettled }),
      { wrapper },
    );
    expect(onSettled).toHaveBeenCalledWith(SkillStatusSchema.enum.FAILED);
  });

  it("stays silent while still uploading and not yet exhausted", () => {
    statusQuery.current = {
      data: SkillStatusSchema.enum.UPLOADING,
      isExhausted: false,
    };
    const onSettled = vi.fn();
    renderHook(
      () =>
        useSkillStatusSync({ skill, version: "v1", parsing: true, onSettled }),
      { wrapper },
    );
    expect(onSettled).not.toHaveBeenCalled();
  });
});
