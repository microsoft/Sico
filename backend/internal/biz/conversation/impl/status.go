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

package impl

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"

	commondto "sico-backend/internal/transport/http/dto/common"
)

func unknownConversationStatuses(ids []int64) map[int64]commondto.ConversationRunStatus {
	statuses := make(map[int64]commondto.ConversationRunStatus, len(ids))
	for _, id := range ids {
		statuses[id] = commondto.ConversationRunStatus_CONVERSATION_RUN_STATUS_UNKNOWN
	}
	return statuses
}

func (s *Service) GetConversationRunStatuses(
	ctx context.Context,
	conversationIDs []int64,
) map[int64]commondto.ConversationRunStatus {
	statuses := unknownConversationStatuses(conversationIDs)
	if len(conversationIDs) == 0 || s.cache == nil {
		return statuses
	}

	keys := make([]string, len(conversationIDs))
	for i, conversationID := range conversationIDs {
		keys[i] = getCacheKeyForOngoingChatTurn(conversationID, 0).turnIdCacheKey
	}
	values, err := s.cache.MGet(ctx, keys...).Result()
	if err != nil {
		return statuses
	}
	for i, value := range values {
		status := commondto.ConversationRunStatus_CONVERSATION_RUN_STATUS_IDLE
		if value != nil {
			status = commondto.ConversationRunStatus_CONVERSATION_RUN_STATUS_RUNNING
		}
		statuses[conversationIDs[i]] = status
	}
	return statuses
}

func (s *Service) GetAgentInstanceConversationRunStatuses(
	ctx context.Context,
	agentInstanceIDs []int64,
) map[int64]commondto.ConversationRunStatus {
	statuses := unknownConversationStatuses(agentInstanceIDs)
	if len(agentInstanceIDs) == 0 || s.cache == nil {
		return statuses
	}

	pipe := s.cache.Pipeline()
	commands := make(map[int64]*redis.IntCmd, len(agentInstanceIDs))
	minScore := fmt.Sprintf("%d", time.Now().Unix())
	for _, agentInstanceID := range agentInstanceIDs {
		key := fmt.Sprintf("ongoing-chat:agent-instance:%d:conversations", agentInstanceID)
		commands[agentInstanceID] = pipe.ZCount(ctx, key, minScore, "+inf")
	}
	if _, err := pipe.Exec(ctx); err != nil {
		return statuses
	}

	for agentInstanceID, command := range commands {
		if command.Err() != nil {
			continue
		}
		status := commondto.ConversationRunStatus_CONVERSATION_RUN_STATUS_IDLE
		if command.Val() > 0 {
			status = commondto.ConversationRunStatus_CONVERSATION_RUN_STATUS_RUNNING
		}
		statuses[agentInstanceID] = status
	}
	return statuses
}
