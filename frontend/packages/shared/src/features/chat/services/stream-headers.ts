import { getOrganizationHeaders } from "../../../services/organization-header";
import { getAccessToken } from "../../../utils/auth-storage";
import { isSameOriginRequest } from "../../../utils/is-same-origin-request";

export function getStreamHeaders(
  url: string,
  getOrganizationId?: () => number | null,
): Record<string, string> {
  const token = getAccessToken();
  const sameOrigin = isSameOriginRequest(url, undefined);
  return {
    "Content-Type": "application/json",
    ...(sameOrigin ? getOrganizationHeaders(getOrganizationId) : {}),
    ...(token && sameOrigin ? { Authorization: `Bearer ${token}` } : {}),
  };
}
