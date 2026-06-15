// Copyright (c) 2026 Sico Authors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

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
	Attachments     []*ChatAttachment `json:"attachments"`
}

// ReconnectRequest represents the HTTP payload for the /conversation/chat/reconnect endpoint.
type ReconnectRequest struct {
	AgentInstanceID int64 `json:"agentInstanceId" binding:"required"`
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
