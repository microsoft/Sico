import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAssetDeleteGate } from "@/features/projects/hooks/use-asset-delete-gate";
import type { AssetDetail } from "@/features/projects/hooks/use-asset-detail-query";
import { deriveCapabilities } from "@/features/rbac/capabilities";
import { useProjectPermission } from "@/features/rbac/hooks/use-project-permission";

vi.mock("@/features/rbac/hooks/use-project-permission", () => ({
  useProjectPermission: vi.fn(),
}));

const mockedUseProjectPermission = vi.mocked(useProjectPermission);

function setPermission(
  role: "project_admin" | "project_member" | null,
  over: { isLoading?: boolean; userEmail?: string } = {},
): void {
  mockedUseProjectPermission.mockReturnValue({
    ...deriveCapabilities(role),
    userEmail: over.userEmail ?? "me@company.com",
    isLoading: over.isLoading ?? false,
    isError: false,
  });
}

// A Knowledge detail owned by `creatorUsername`.
function knowledgeBy(creatorUsername: string): AssetDetail {
  return { type: "knowledge", creatorUsername } as unknown as AssetDetail;
}

// A Deliverable detail produced by a DW whose human operator is `operator`.
function deliverableByOperator(operator: string): AssetDetail {
  return {
    type: "deliverable",
    extraInfo: { agentInstance: { operatorUsername: operator } },
  } as unknown as AssetDetail;
}

describe("useAssetDeleteGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows an admin to delete any asset", () => {
    setPermission("project_admin");
    const { result } = renderHook(() =>
      useAssetDeleteGate(knowledgeBy("someone.else@x.com"), 7),
    );
    expect(result.current).toBe(true);
  });

  it("allows a member to delete a knowledge doc they created", () => {
    setPermission("project_member", { userEmail: "me@company.com" });
    const { result } = renderHook(() =>
      useAssetDeleteGate(knowledgeBy("me@company.com"), 7),
    );
    expect(result.current).toBe(true);
  });

  it("denies a member deleting a knowledge doc created by someone else", () => {
    setPermission("project_member", { userEmail: "me@company.com" });
    const { result } = renderHook(() =>
      useAssetDeleteGate(knowledgeBy("other@company.com"), 7),
    );
    expect(result.current).toBe(false);
  });

  it("allows a member to delete a deliverable they operated (own)", () => {
    setPermission("project_member", { userEmail: "me@company.com" });
    const { result } = renderHook(() =>
      useAssetDeleteGate(deliverableByOperator("me@company.com"), 7),
    );
    expect(result.current).toBe(true);
  });

  it("fails closed while the permission query is loading", () => {
    setPermission("project_admin", { isLoading: true });
    const { result } = renderHook(() =>
      useAssetDeleteGate(knowledgeBy("me@company.com"), 7),
    );
    expect(result.current).toBe(false);
  });
});
