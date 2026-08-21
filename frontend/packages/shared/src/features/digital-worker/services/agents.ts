import type { AxiosInstance } from "axios";
import { z } from "zod";

import { apiResponseSchema, assertOk, unwrapData } from "../../../schemas/api";
import { type Paged } from "../../../schemas/paginated";
import { DEFAULT_AGENTS_PAGE_SIZE } from "../constants";
import { type Agent, agentSchema, type AgentStatus } from "../schemas/agent";

// Backend `data` is `{ instances, total, hasNext }`. Rename `instances`
// → `items` so callers receive the canonical `Paged<T>` shape.
const envelope = apiResponseSchema(
  z
    .object({
      instances: z.array(agentSchema),
      total: z.number().int().nonnegative(),
      hasNext: z.boolean(),
    })
    .transform(
      ({ instances, ...rest }): Paged<Agent> => ({
        items: instances,
        total: rest.total,
        hasNext: rest.hasNext,
      }),
    ),
);

// Backend enforces `pageSize` max=50; clamp client-side so the limit is
// visible at the call site rather than surfacing as a 400.
const MAX_AGENTS_PAGE_SIZE = 50;

// Backend sort dimensions for the instance list (`orderBy`). Values mirror the
// dwp `ListSingleAgentInstancesRequest` contract — wire integers, do not
// renumber. `z.enum` (the lint bans TS `enum`) so value + type share one
// source; access members via `AgentOrderBySchema.enum.ConversationActivity`.
export const AgentOrderBySchema = z.enum({
  CreatedAt: 1,
  UpdatedAt: 2,
  // Most-recent conversation activity — surfaces recently-used DWs first.
  ConversationActivity: 3,
});
export type AgentOrderBy = z.infer<typeof AgentOrderBySchema>;

// Sort direction shared across list endpoints (`sortOrder`).
export const SortOrderSchema = z.enum({ Asc: 0, Desc: 1 });
export type SortOrder = z.infer<typeof SortOrderSchema>;

export type AgentsParams = {
  page?: number;
  pageSize?: number;
  /** Scope to DWs a user OPERATES — the "my DWs" filter (dashboard + sidebar).
   * The backend no longer forces the current user, so this must be sent
   * explicitly. */
  operatorUsername?: string;
  /** Scope to DWs a user EMPLOYS. Rarely used from the client. */
  employerUsername?: string;
  /** Scope the list to one project (backend-filtered). Omit + no operator for
   * the whole roster. */
  projectId?: number;
  orderBy?: AgentOrderBy;
  sortOrder?: SortOrder;
  // Statuses to include. The backend `statusList` form param is a comma-joined
  // list of `AgentStatus` wire integers; callers pass the typed values and the
  // CSV join happens here. An empty/absent array returns every status (the
  // param is omitted), so "show all" sends no filter.
  statusList?: AgentStatus[];
};

export async function fetchAgents(
  apiClient: AxiosInstance,
  {
    page = 1,
    pageSize = DEFAULT_AGENTS_PAGE_SIZE,
    operatorUsername,
    employerUsername,
    projectId,
    orderBy = AgentOrderBySchema.enum.ConversationActivity,
    sortOrder = SortOrderSchema.enum.Desc,
    statusList,
  }: AgentsParams = {},
): Promise<Paged<Agent>> {
  const clampedPageSize = Math.min(pageSize, MAX_AGENTS_PAGE_SIZE);
  const res = await apiClient.get<unknown>("/agent/single_agent_instances", {
    params: {
      page,
      pageSize: clampedPageSize,
      orderBy,
      sortOrder,
      ...(operatorUsername === undefined ? {} : { operatorUsername }),
      ...(employerUsername === undefined ? {} : { employerUsername }),
      ...(projectId === undefined ? {} : { projectId }),
      // Join to the backend's CSV form only when non-empty — an absent key
      // sends no `statusList`, so the backend returns all statuses ("show all").
      ...(statusList?.length ? { statusList: statusList.join(",") } : {}),
    },
  });
  const parsed = envelope.parse(res.data);
  if (!parsed.data) {
    // Missing `data` on a 200 envelope (incl. the `100004 agent not found`
    // null-data case) → schema bucket in `classifyError` so the failure
    // surfaces the error UI.
    throw new z.ZodError([
      {
        code: "custom",
        path: ["data"],
        message: "fetchAgents: missing data in envelope",
      },
    ]);
  }
  return parsed.data;
}

// Detail envelope: backend wraps the agent in `data.instance`
// (single_agent_instance.proto: GetSingleAgentInstanceResponse.data.instance).
const detailEnvelope = apiResponseSchema(z.object({ instance: agentSchema }));

// Singular detail fetch for the header (deep-link / refresh safe — the
// infinite-list cache may never have loaded this agent's page). §6.E7.
export async function fetchAgentDetail(
  apiClient: AxiosInstance,
  agentId: number,
): Promise<Agent> {
  const res = await apiClient.get<unknown>("/agent/single_agent_instance", {
    params: { id: agentId },
  });
  const parsed = detailEnvelope.parse(res.data);
  if (!parsed.data) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["data"],
        message: "fetchAgentDetail: missing data in envelope",
      },
    ]);
  }
  return parsed.data.instance;
}

// Update a single agent instance's lifecycle status. dwp uses this to flip a
// NEW worker to ACTIVE on first open (clears the card's NEW dot). The response
// payload is unused — but the envelope `code` must still be asserted: the
// backend signals failures (e.g. permission denial) as a non-OK code inside an
// HTTP-200 envelope, which axios resolves as success. Without `assertOk` a
// rejected write would be reported to the caller as a success.
export async function updateAgentInstanceStatus(
  apiClient: AxiosInstance,
  { id, status }: { id: number; status: AgentStatus },
): Promise<void> {
  const response = await apiClient.put<unknown>(
    "/agent/single_agent_instance/status",
    { id, status },
  );
  const parsed = apiResponseSchema(z.unknown()).parse(response.data);
  assertOk(parsed, "updateAgentInstanceStatus");
}

// Create a digital-worker instance from an existing agent template
// (`POST /agent/single_agent_instance`). `agentId` names the template (from
// `GET /agent/single_agent_infos`); `employerUsername` is the current user
// (their email — the User schema carries no username). `role` is copied from
// the chosen template. Only the new instance `id` is consumed by callers, so
// the schema is narrowed to that (the backend echoes more, but requiring those
// fields would turn a successful create into a parse error if they ever drop).
const createdInstanceSchema = z.object({
  id: z.number().int().safe(),
});
const createInstanceEnvelope = apiResponseSchema(createdInstanceSchema);

export type CreateAgentInstanceInput = {
  agentId: string;
  employerUsername: string;
  name: string;
  // Required by the backend (`CreateSingleAgentInstanceRequest.ProjectId` has a
  // `required` tag) — the instance is created directly under a project.
  projectId: number;
  role?: string;
  iconUri?: string;
};

export type CreatedAgentInstance = z.infer<typeof createdInstanceSchema>;

export async function createAgentInstance(
  apiClient: AxiosInstance,
  {
    agentId,
    employerUsername,
    name,
    projectId,
    role = "",
    iconUri = "",
  }: CreateAgentInstanceInput,
): Promise<CreatedAgentInstance> {
  const response = await apiClient.post<unknown>(
    "/agent/single_agent_instance",
    { agentId, employerUsername, name, projectId, role, iconUri },
  );
  return unwrapData(
    createInstanceEnvelope.parse(response.data),
    "createAgentInstance",
  );
}

// Dismiss (remove) a digital-worker instance from its project
// (`POST /agent/single_agent_instance/dismiss`). Response payload is unused;
// the envelope `code` is still asserted so an HTTP-200 permission denial
// rejects rather than reporting success (same reasoning as
// `updateAgentInstanceStatus`).
export async function dismissAgentInstance(
  apiClient: AxiosInstance,
  { id }: { id: number },
): Promise<void> {
  const response = await apiClient.post<unknown>(
    "/agent/single_agent_instance/dismiss",
    { id },
  );
  assertOk(
    apiResponseSchema(z.unknown()).parse(response.data),
    "dismissAgentInstance",
  );
}

// Reassign a digital-worker instance to a new operator
// (`POST /agent/single_agent_instance/reassign`). `newOperatorUsername` is the
// target member's email (users carry no separate username). Envelope `code`
// asserted for the same HTTP-200-denial reason as above.
export async function reassignAgentInstance(
  apiClient: AxiosInstance,
  { id, newOperatorUsername }: { id: number; newOperatorUsername: string },
): Promise<void> {
  const response = await apiClient.post<unknown>(
    "/agent/single_agent_instance/reassign",
    { id, newOperatorUsername },
  );
  assertOk(
    apiResponseSchema(z.unknown()).parse(response.data),
    "reassignAgentInstance",
  );
}
