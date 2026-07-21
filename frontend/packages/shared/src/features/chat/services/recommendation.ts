import type { AxiosInstance } from "axios";

import { apiResponseSchema, unwrapData } from "../../../schemas/api";
import {
  type RecommendationTask,
  recommendationTasksSchema,
} from "../schemas/recommendation-task";

const envelope = apiResponseSchema(recommendationTasksSchema);

// Onboarding suggested tasks for the empty-state ConversationStarter. POST
// (not GET) mirrors the legacy contract: the agent instance id rides in the
// body. Returns the bare task array — the `{ tasks }` envelope is unwrapped
// here so callers get a canonical list.
export async function fetchRecommendationTasks(
  apiClient: AxiosInstance,
  agentInstanceId: number,
): Promise<RecommendationTask[]> {
  const res = await apiClient.post<unknown>(
    "/conversation/onboard/recommendation_tasks",
    { agentInstanceId },
  );
  const parsed = envelope.parse(res.data);
  return unwrapData(parsed, "fetchRecommendationTasks").tasks;
}
