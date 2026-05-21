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

package mock

import (
	"context"

	"gorm.io/gorm"

	entity "sico-backend/internal/entity/conversation/conversation"
	"sico-backend/internal/store/conversation/conversation/repository"
)

type mockConversationRepo struct {
	conversations map[int64]*entity.Conversation
	counter       int64
}

func NewMockConversationRepo() repository.ConversationRepo {
	return &mockConversationRepo{
		conversations: make(map[int64]*entity.Conversation),
		counter:       0,
	}
}

func copyConversation(c *entity.Conversation) *entity.Conversation {
	clone := *c
	return &clone
}

func (m *mockConversationRepo) Create(_ context.Context, msg *entity.Conversation) (*entity.Conversation, error) {
	m.counter++
	msg.ID = m.counter
	m.conversations[msg.ID] = copyConversation(msg)
	return copyConversation(msg), nil
}

func (m *mockConversationRepo) Update(_ context.Context, msg *entity.Conversation) error {
	if _, exists := m.conversations[msg.ID]; !exists {
		return gorm.ErrRecordNotFound
	}
	m.conversations[msg.ID] = copyConversation(msg)
	return nil
}

func (m *mockConversationRepo) GetByID(_ context.Context, id int64) (*entity.Conversation, error) {
	if c, exists := m.conversations[id]; exists {
		return copyConversation(c), nil
	}
	return nil, nil
}

func (m *mockConversationRepo) Get(
	_ context.Context,
	username string, agentID string,
	agentInstanceID int64,
) (*entity.Conversation, error) {
	for _, c := range m.conversations {
		if c.CreatorUsername == username && c.AgentID == agentID && c.AgentInstanceID == agentInstanceID {
			return copyConversation(c), nil
		}
	}
	return nil, nil
}

func (m *mockConversationRepo) Delete(_ context.Context, id int64) (int64, error) {
	if _, exists := m.conversations[id]; !exists {
		return 0, gorm.ErrRecordNotFound
	}
	delete(m.conversations, id)
	return id, nil
}

func (m *mockConversationRepo) List(
	_ context.Context,
	username string, agentID string, agentInstanceID int64,
	limit int, page int,
) ([]*entity.Conversation, bool, error) {
	var filtered []*entity.Conversation
	for _, c := range m.conversations {
		if c.CreatorUsername == username && c.AgentID == agentID && c.AgentInstanceID == agentInstanceID {
			filtered = append(filtered, copyConversation(c))
		}
	}
	offset := (page - 1) * limit
	if offset < 0 {
		offset = 0
	}
	if offset >= len(filtered) {
		return []*entity.Conversation{}, false, nil
	}
	end := offset + limit
	hasMore := end < len(filtered)
	if end > len(filtered) {
		end = len(filtered)
	}
	return filtered[offset:end], hasMore, nil
}

func (m *mockConversationRepo) CountByStatus(
	_ context.Context,
	username string, agentID string, agentInstanceID int64,
) (map[int32]int64, error) {
	result := make(map[int32]int64)
	for _, c := range m.conversations {
		if c.CreatorUsername == username && c.AgentID == agentID && c.AgentInstanceID == agentInstanceID {
			result[c.Status]++
		}
	}
	return result, nil
}
