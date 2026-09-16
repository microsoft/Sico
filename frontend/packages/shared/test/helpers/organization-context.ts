import type { OrganizationSummary } from "@/features/organization/schemas/organization";
import type { LoginResponse } from "@/schemas/auth";

export function deferOrganizations(): {
  promise: Promise<OrganizationSummary[]>;
  resolve: (organizations: OrganizationSummary[]) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (organizations: OrganizationSummary[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<OrganizationSummary[]>(
    (resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    },
  );
  return { promise, resolve, reject };
}

export function makeOrganization(id = 9): OrganizationSummary {
  return {
    id,
    name: `Organization ${id}`,
    description: "",
    createdAt: 1,
    updatedAt: 1,
    creatorUsername: "owner@example.com",
    roleCodes: [],
    isOwner: false,
  };
}

export function makeLoginPayload(
  userId = 7,
  token = "test-session",
): LoginResponse {
  return {
    user: { id: userId, email: `user${userId}@example.com`, roles: [] },
    tokenInfo: {
      accessToken: token,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    },
  };
}
