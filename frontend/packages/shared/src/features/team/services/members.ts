import type { AxiosInstance } from "axios";

import { RoleCodeSchema } from "../../rbac/schemas/user-role";
import { listUsersByRole } from "../../rbac/services/user-role";
import { type ProjectMember } from "../schemas/member";

const SCOPE_TYPE = "project";

// The Person tab's member list. The RBAC backend has no single "project
// members" endpoint — it lists users per role — so we fetch both project roles
// and merge, tagging each user with its role. A user granted both roles is
// deduped to `project_admin` (admins are listed first, so first-seen wins).
export async function fetchProjectMembers(
  client: AxiosInstance,
  projectId: number,
): Promise<ProjectMember[]> {
  const [admins, members] = await Promise.all([
    listUsersByRole(client, {
      roleCode: RoleCodeSchema.enum.project_admin,
      scopeType: SCOPE_TYPE,
      scopeId: projectId,
    }),
    listUsersByRole(client, {
      roleCode: RoleCodeSchema.enum.project_member,
      scopeType: SCOPE_TYPE,
      scopeId: projectId,
    }),
  ]);

  const byId = new Map<number, ProjectMember>();
  for (const user of admins) {
    byId.set(user.id, { ...user, roleCode: RoleCodeSchema.enum.project_admin });
  }
  for (const user of members) {
    if (!byId.has(user.id)) {
      byId.set(user.id, {
        ...user,
        roleCode: RoleCodeSchema.enum.project_member,
      });
    }
  }
  return Array.from(byId.values());
}
