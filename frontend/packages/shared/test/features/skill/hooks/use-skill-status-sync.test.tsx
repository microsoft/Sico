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
