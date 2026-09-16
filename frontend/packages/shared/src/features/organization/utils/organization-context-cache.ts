import {
  ORGANIZATION_CONTEXT_LS,
  removeItemFromLocalStorage,
  safeGetItemFromLocalStorage,
  safeSetItemToLocalStorage,
} from "../../../utils/local-storage";
import { logger } from "../../../utils/logger";
import type { OrganizationSummary } from "../schemas/organization";
import { organizationContextCacheSchema } from "../schemas/organization-context-cache";

// This is a routing hint, never a cached authorization decision.
export function readOrganizationContextCache(
  userId: number,
): OrganizationSummary[] | null {
  try {
    const cache = safeGetItemFromLocalStorage(
      ORGANIZATION_CONTEXT_LS,
      organizationContextCacheSchema,
    );
    return cache?.userId === userId ? cache.organizations : null;
  } catch {
    logger.warn("organization context cache unavailable", {
      operation: "read",
      key: ORGANIZATION_CONTEXT_LS,
    });
    return null;
  }
}

export function persistOrganizationContextCache(
  userId: number,
  organizations: OrganizationSummary[],
): void {
  try {
    if (organizations.length === 0) {
      removeItemFromLocalStorage(ORGANIZATION_CONTEXT_LS);
      return;
    }
    safeSetItemToLocalStorage(
      ORGANIZATION_CONTEXT_LS,
      organizationContextCacheSchema,
      { version: 1, userId, organizations },
    );
  } catch {
    logger.warn("organization context cache unavailable", {
      operation: organizations.length === 0 ? "remove" : "write",
      key: ORGANIZATION_CONTEXT_LS,
    });
  }
}
