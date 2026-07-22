/**
 * Copyright (c) 2026 Sico Authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

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
