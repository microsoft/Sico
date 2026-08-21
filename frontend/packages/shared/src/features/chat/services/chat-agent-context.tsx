import {
  createContext,
  type JSX,
  type ReactNode,
  useContext,
  useMemo,
} from "react";

// Ambient context for the active chat view: the agent instance id AND the
// conversation id. Deep leaves (PlanCard's `/plan` poll, AddToProjectButton)
// need one or both, but the intermediate MessageList/MessageCard don't read
// them — context avoids prop-drilling.
type ChatAgentContextValue = {
  readonly agentInstanceId: number;
  readonly conversationId: number;
};

const ChatAgentContext = createContext<ChatAgentContextValue | null>(null);

export function ChatAgentProvider({
  agentInstanceId,
  conversationId,
  children,
}: {
  readonly agentInstanceId: number;
  readonly conversationId: number;
  readonly children: ReactNode;
}): JSX.Element {
  const value = useMemo(
    () => ({ agentInstanceId, conversationId }),
    [agentInstanceId, conversationId],
  );
  return (
    <ChatAgentContext.Provider value={value}>
      {children}
    </ChatAgentContext.Provider>
  );
}

function useChatAgentContext(): ChatAgentContextValue {
  const value = useContext(ChatAgentContext);
  if (value === null) {
    throw new Error("useChatAgent* must be used within a ChatAgentProvider");
  }
  return value;
}

export function useChatAgentId(): number {
  return useChatAgentContext().agentInstanceId;
}

export function useChatConversationId(): number {
  return useChatAgentContext().conversationId;
}
