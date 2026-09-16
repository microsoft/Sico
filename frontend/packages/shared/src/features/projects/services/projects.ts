import type { AxiosInstance } from "axios";
import { z } from "zod";

import { PROJECT_ENDPOINTS } from "../../../constants/endpoints";
import { apiResponseSchema, assertOk, unwrapData } from "../../../schemas/api";
import { type Paged } from "../../../schemas/paginated";
import {
  DEFAULT_PROJECT_MEMBER_TYPE,
  DEFAULT_PROJECT_PAGE_SIZE,
} from "../constants";
import {
  type MemberType,
  type OrganizationProject,
  organizationProjectSchema,
  type Project,
  type ProjectDetail,
  projectDetailSchema,
  projectSchema,
} from "../schemas/project";

// Rename `projects` → `items` so callers receive the canonical `Paged<T>` shape.
const envelope = apiResponseSchema(
  z
    .object({
      projects: z.array(projectSchema),
      total: z.number().int().nonnegative(),
      hasNext: z.boolean(),
    })
    .transform(
      ({ projects, ...rest }): Paged<Project> => ({
        items: projects,
        total: rest.total,
        hasNext: rest.hasNext,
      }),
    ),
);

// Backend enforces `pageSize` max=100; clamp client-side so the limit
// is visible at the call site rather than surfacing as a 400.
const MAX_PROJECTS_PAGE_SIZE = 100;

type ProjectsParams = {
  page?: number;
  pageSize?: number;
  memberType?: MemberType;
};

export async function fetchProjects(
  apiClient: AxiosInstance,
  {
    page = 1,
    pageSize = DEFAULT_PROJECT_PAGE_SIZE,
    memberType = DEFAULT_PROJECT_MEMBER_TYPE,
  }: ProjectsParams = {},
): Promise<Paged<Project>> {
  const clampedPageSize = Math.min(pageSize, MAX_PROJECTS_PAGE_SIZE);
  const response = await apiClient.get<unknown>(
    PROJECT_ENDPOINTS.userProjects,
    {
      params: { page, pageSize: clampedPageSize, memberType },
    },
  );

  const parsed = envelope.parse(response.data);
  return unwrapData(parsed, "fetchProjects");
}

const organizationProjectsEnvelope = apiResponseSchema(
  z
    .object({
      projects: z
        .array(organizationProjectSchema)
        .nullish()
        .transform((projects) => projects ?? []),
      total: z.number().int().nonnegative(),
      hasNext: z.boolean(),
    })
    .transform(
      ({ projects, ...rest }): Paged<OrganizationProject> => ({
        items: projects,
        total: rest.total,
        hasNext: rest.hasNext,
      }),
    ),
);

const DEFAULT_ORGANIZATION_PROJECT_PAGE_SIZE = 50;

type OrganizationProjectsParams = {
  page?: number;
  pageSize?: number;
};

export async function fetchOrganizationProjects(
  apiClient: AxiosInstance,
  organizationId: number,
  {
    page = 1,
    pageSize = DEFAULT_ORGANIZATION_PROJECT_PAGE_SIZE,
  }: OrganizationProjectsParams = {},
): Promise<Paged<OrganizationProject>> {
  const response = await apiClient.get<unknown>(PROJECT_ENDPOINTS.list, {
    params: {
      organizationId,
      page,
      pageSize: Math.min(pageSize, MAX_PROJECTS_PAGE_SIZE),
    },
  });
  const projects = unwrapData(
    organizationProjectsEnvelope.parse(response.data),
    "fetchOrganizationProjects",
  );
  if (
    projects.items.some(
      (project) =>
        project.organizationId !== 0 &&
        project.organizationId !== organizationId,
    )
  ) {
    throw new Error("Project outside requested organization scope");
  }
  return projects;
}

const detailEnvelope = apiResponseSchema(projectDetailSchema);

export async function fetchProjectDetail(
  apiClient: AxiosInstance,
  id: number,
): Promise<ProjectDetail> {
  const response = await apiClient.get<unknown>(PROJECT_ENDPOINTS.root, {
    params: { id },
  });
  const parsed = detailEnvelope.parse(response.data);
  return unwrapData(parsed, "fetchProjectDetail");
}

const idEnvelope = apiResponseSchema(z.object({ id: z.number().int() }));

// `operatorAdmins` is ALWAYS sent in full by the caller — the data-loss
// invariant (§6 dec 6) is enforced in the hook layer, so this service just
// forwards the body. Note the icon asymmetry: requests write `iconUri`, while
// responses read `iconUrl`.
type UpdateProjectBody = {
  id: number;
  name?: string;
  description?: string;
  iconUri?: string;
  operatorAdmins: string[];
};

export async function updateProject(
  apiClient: AxiosInstance,
  body: UpdateProjectBody,
): Promise<void> {
  const response = await apiClient.put<unknown>(PROJECT_ENDPOINTS.root, body);
  // PUT /project returns a bare `{ code, msg }` envelope — no `data.id` (unlike
  // POST /project). Assert the code only; requiring `data` here would throw
  // "missing data" on every successful edit.
  assertOk(
    apiResponseSchema(z.unknown()).parse(response.data),
    "updateProject",
  );
}

// Delete a project (`DELETE /project?id`). Bare `{ code, msg }` envelope like
// `updateProject` — assert the code only.
export async function deleteProject(
  apiClient: AxiosInstance,
  id: number,
): Promise<void> {
  const response = await apiClient.delete<unknown>(PROJECT_ENDPOINTS.root, {
    params: { id },
  });
  assertOk(
    apiResponseSchema(z.unknown()).parse(response.data),
    "deleteProject",
  );
}

// Create a project (`POST /project`). Only backend-supported fields are sent.
// `operatorAdmins` is passed explicitly as `[]` (create has no data-loss
// concern — the backend records the creator as owner); the draft's teammates
// multi-select + emoji cover have no create-endpoint field and are omitted.
type CreateProjectBody = {
  name: string;
  organizationId: number;
  description?: string;
  iconUri?: string;
};

export async function createProject(
  apiClient: AxiosInstance,
  { name, organizationId, description = "", iconUri = "" }: CreateProjectBody,
): Promise<number> {
  const response = await apiClient.post<unknown>(PROJECT_ENDPOINTS.root, {
    name,
    organizationId,
    description,
    iconUri,
    operatorAdmins: [],
  });
  const parsed = idEnvelope.parse(response.data);
  return unwrapData(parsed, "createProject").id;
}
