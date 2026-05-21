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

package handler

import (
	"encoding/json"
	"time"

	"github.com/gin-gonic/gin"

	conversationbiz "sico-backend/internal/biz/conversation"
	"sico-backend/internal/infra/sse"
	conversationdto "sico-backend/internal/transport/http/dto/conversation"
	"sico-backend/pkg/logger"
)

// Chat proxies chat requests to the gRPC streaming backend.
// @Router /api/sico/conversation/chat [POST]
// @Tags Conversation
// @Accept json
// @Produce text/event-stream
// @Param request body conversationdto.ChatRequestHttp true "Chat Request"
// @Success 200 {object} conversationdto.ChatStreamResponse
// @Security BearerAuth
func Chat(ctx *gin.Context) {
	var req conversationdto.ChatRequestHttp
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	sseSender := sse.NewSSESender(ctx)
	sse.UseKeepalive(reqctx(ctx), sseSender, 10*time.Second)

	if err := conversationbiz.Default().Chat(reqctx(ctx), sseSender, &req); err != nil {
		logger.CtxError(ctx, "chat stream failed: %v", err)
		// temporarily set to 500
		errPayload, _ := json.Marshal(err.Error())
		if sendErr := sseSender.Send(ctx, &sse.Event{Event: "error", Data: errPayload}); sendErr != nil {
			logger.CtxError(ctx, "chat error stream send failed: %v", sendErr)
		}
		sseSender.NotifyClosed()
	}
}

// Reconnect proxies chat reconnect requests to the gRPC streaming backend.
// @Router /api/sico/conversation/chat/reconnect [POST]
// @Tags Conversation
// @Accept json
// @Produce text/event-stream
// @Param request body conversationdto.ReconnectRequest true "chat Reconnect Request"
// @Success 200 {object} conversationdto.ChatStreamResponse
// @Security BearerAuth
func Reconnect(ctx *gin.Context) {
	var req conversationdto.ReconnectRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	sseSender := sse.NewSSESender(ctx)
	sse.UseKeepalive(reqctx(ctx), sseSender, 10*time.Second)

	if err := conversationbiz.Default().Reconnect(reqctx(ctx), sseSender, &req); err != nil {
		logger.CtxError(ctx, "chat reconnect stream failed: %v", err)
		// temporarily set to 500
		errPayload, _ := json.Marshal(err.Error())

		if sendErr := sseSender.Send(ctx, &sse.Event{Event: "error", Data: errPayload}); sendErr != nil {
			logger.CtxError(ctx, "chat reconnect error stream send failed: %v", sendErr)
		}

		sseSender.NotifyClosed()
	}
}
