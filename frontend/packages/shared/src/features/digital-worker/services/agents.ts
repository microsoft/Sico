import type { AxiosInstance } from "axios";
import { z } from "zod";

import { apiResponseSchema, assertOk, unwrapData } from "../../../schemas/api";
import { type Paged } from "../../../schemas/paginated";
import {
  DEFAULT_AGENTS_IS_EMPLOYER,
  DEFAULT_AGENTS_PAGE_SIZE,
} from "../constants";
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

export type AgentsParams = {
  page?: number;
  pageSize?: number;
  isEmployer?: boolean;
};

export async function fetchAgents(
  apiClient: AxiosInstance,
  {
    page = 1,
    pageSize = DEFAULT_AGENTS_PAGE_SIZE,
    isEmployer = DEFAULT_AGENTS_IS_EMPLOYER,
  }: AgentsParams = {},
): Promise<Paged<Agent>> {
  const clampedPageSize = Math.min(pageSize, MAX_AGENTS_PAGE_SIZE);
  const res = await apiClient.get<unknown>("/agent/single_agent_instances", {
    params: { page, pageSize: clampedPageSize, isEmployer },
  });
  const parsed = envelope.parse(res.data);
  if (!parsed.data) {
    // Missing data on a 200 envelope → schema bucket in `classifyError`.
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
