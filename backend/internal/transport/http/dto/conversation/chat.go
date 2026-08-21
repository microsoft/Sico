package conversation

import (
	commondto "sico-backend/internal/transport/http/dto/common"
)

// ChatAttachment reuses the shared attachment definition used across conversation APIs.
type ChatAttachment = commondto.Attachment

// ChatRequestHttp represents the HTTP payload for the /conversation/chat endpoint.
type ChatRequestHttp struct {
	Message         string            `json:"message" binding:"required"`
	AgentInstanceID int64             `json:"agentInstanceId" binding:"required"`
	ConversationID  int64             `json:"conversationId"`
	Attachments     []*ChatAttachment `json:"attachments"`
}

// ReconnectRequest represents the HTTP payload for the /conversation/chat/reconnect endpoint.
type ReconnectRequest struct {
	AgentInstanceID int64 `json:"agentInstanceId" binding:"required"`
	ConversationID  int64 `json:"conversationId"`
}

// ChatStreamResponse mirrors the payload emitted per SSE message.
type ChatStreamResponse struct {
	Type            MessageContentType `json:"type"`
	Content         string             `json:"content,omitempty"`
	FunctionContext *FunctionContext   `json:"functionContext,omitempty"`
	Timestamp       int64              `json:"timestamp"`
	IsFinal         bool               `json:"isFinal"`
	Role            string             `json:"role"`
	ConversationID  int64              `json:"conversationId"`
	TurnID          int64              `json:"turnId"`
}

// ChatFunctionContext describes the tool call/result context payload.
type ChatFunctionContext struct {
	CallID    string         `json:"callId"`
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments"`
	Result    string         `json:"result"`
	Exception string         `json:"exception"`
}

// TimestampedData represents a simple payload with a timestamp field for SSE events.
type TimestampedData struct {
	Timestamp int64 `json:"timestamp"`
}
