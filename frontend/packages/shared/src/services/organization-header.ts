export function getOrganizationHeaders(
  getOrganizationId?: () => number | null,
): Record<string, string> {
  const organizationId = getOrganizationId?.();
  if (
    organizationId === undefined ||
    organizationId === null ||
    !Number.isSafeInteger(organizationId) ||
    organizationId <= 0
  ) {
    return {};
  }
  return { "X-Sico-Organization-ID": String(organizationId) };
}
