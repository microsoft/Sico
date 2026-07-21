import type { AxiosInstance } from "axios";

import { apiResponseSchema, unwrapData } from "../../../schemas/api";
import {
  conversationDetailSchema,
  conversationListSchema,
  type ConversationSummary,
  conversationSummarySchema,
  type CreateConversationRequest,
} from "../schemas/conversation";

const createEnvelope = apiResponseSchema(conversationSummarySchema);
const detailEnvelope = apiResponseSchema(conversationDetailSchema);
const listEnvelope = apiResponseSchema(conversationListSchema);

// Create a fresh conversation under a Digital Worker. `create-first`: the home
// page calls this on send to mint the server id BEFORE navigating to the chat
// route, so the conversation is addressable (routed + listed) from the first
// message. Returns the bare summary (envelope unwrapped here).
export async function createConversation(
  apiClient: AxiosInstance,
  body: CreateConversationRequest,
): Promise<ConversationSummary> {
  const res = await apiClient.post<unknown>("/conversation", body);
  const parsed = createEnvelope.parse(res.data);
  return unwrapData(parsed, "createConversation");
}

export type ConversationListPage = {
  items: ConversationSummary[];
  hasNext: boolean;
};

// Fetch one conversation by id. Used to poll for the async-generated title: the
// backend returns a placeholder ("New Session") from create, then fills in a real
// title derived from the first message. The dwp wire is `GET /conversation?id=`
// with the record nested under `data.conversation`; the inner object reuses the
// summary schema (extra fields ignored), so it patches straight into list rows.
export async function getConversation(
  apiClient: AxiosInstance,
  id: number,
): Promise<ConversationSummary> {
  const res = await apiClient.get<unknown>("/conversation", {
    params: { id },
  });
  const parsed = detailEnvelope.parse(res.data);
  return unwrapData(parsed, "getConversation").conversation;
}

// List a Digital Worker's conversations (newest-first, paginated). The backend
// filters by `agentInstanceId` server-side, so the client passes it straight
// through. Renames `{conversations, hasMore}` → `{items, hasNext}` for a
// canonical page shape (mirrors history.ts).
export async function listConversations(
  apiClient: AxiosInstance,
  agentInstanceId: number,
  page = 1,
  pageSize = 20,
): Promise<ConversationListPage> {
  const res = await apiClient.get<unknown>("/conversation/list", {
    params: { agentInstanceId, page, pageSize },
  });
  const parsed = listEnvelope.parse(res.data);
  const { conversations, hasMore } = unwrapData(parsed, "listConversations");
  return { items: conversations, hasNext: hasMore };
}
