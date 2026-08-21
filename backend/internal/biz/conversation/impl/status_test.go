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
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"

	commondto "sico-backend/internal/transport/http/dto/common"
)

func newStatusTestService(t *testing.T) (*Service, *miniredis.Miniredis) {
	t.Helper()
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	return &Service{cache: client}, server
}

func TestGetConversationRunStatuses(t *testing.T) {
	service, server := newStatusTestService(t)
	require.NoError(t, server.Set("ongoing-chat:conversation:1", "10"))

	statuses := service.GetConversationRunStatuses(context.Background(), []int64{1, 2})

	require.Equal(t, commondto.ConversationRunStatus_CONVERSATION_RUN_STATUS_RUNNING, statuses[1])
	require.Equal(t, commondto.ConversationRunStatus_CONVERSATION_RUN_STATUS_IDLE, statuses[2])

	server.Close()
	statuses = service.GetConversationRunStatuses(context.Background(), []int64{1})
	require.Equal(t, commondto.ConversationRunStatus_CONVERSATION_RUN_STATUS_UNKNOWN, statuses[1])
}

func TestGetAgentInstanceConversationRunStatuses(t *testing.T) {
	service, server := newStatusTestService(t)
	key := "ongoing-chat:agent-instance:1:conversations"
	_, err := server.ZAdd(key, float64(time.Now().Add(time.Minute).Unix()), "11")
	require.NoError(t, err)
	_, err = server.ZAdd(key, float64(time.Now().Add(-time.Minute).Unix()), "12")
	require.NoError(t, err)

	statuses := service.GetAgentInstanceConversationRunStatuses(context.Background(), []int64{1, 2})

	require.Equal(t, commondto.ConversationRunStatus_CONVERSATION_RUN_STATUS_RUNNING, statuses[1])
	require.Equal(t, commondto.ConversationRunStatus_CONVERSATION_RUN_STATUS_IDLE, statuses[2])

	server.Close()
	statuses = service.GetAgentInstanceConversationRunStatuses(context.Background(), []int64{1})
	require.Equal(t, commondto.ConversationRunStatus_CONVERSATION_RUN_STATUS_UNKNOWN, statuses[1], fmt.Sprint(statuses))
}
