package mock

import (
	"context"
	"slices"
	"sort"

	"google.golang.org/protobuf/proto"

	entity "sico-backend/internal/entity/conversation/message"
	"sico-backend/internal/store/conversation/message/repository"
)

type mockMessageRepo struct {
	messages map[int64]*entity.Message
	counter  int64
}

func NewMockMessageRepo() repository.MessageRepo {
	return &mockMessageRepo{
		messages: make(map[int64]*entity.Message),
		counter:  0,
	}
}

func (m *mockMessageRepo) Create(_ context.Context, msg *entity.Message) (*entity.Message, error) {
	m.counter++
	msg.Id = m.counter
	m.messages[msg.Id] = proto.Clone(msg).(*entity.Message)
	return proto.Clone(msg).(*entity.Message), nil
}

func (m *mockMessageRepo) GetLatestTurnID(_ context.Context, conversationID int64) (int64, error) {
	var maxTurnID int64
	for _, msg := range m.messages {
		if msg.ConversationId == conversationID && msg.TurnId > maxTurnID {
			maxTurnID = msg.TurnId
		}
	}
	return maxTurnID, nil
}

func (m *mockMessageRepo) ListByFilter(
	_ context.Context, filter *repository.MessageFilter,
) ([]*entity.Message, bool, error) {
	var result []*entity.Message
	for _, msg := range m.messages {
		if !messageMatchesFilter(msg, filter) {
			continue
		}
		result = append(result, proto.Clone(msg).(*entity.Message))
	}

	if filter.IdDescending {
		sort.Slice(result, func(i, j int) bool {
			return result[i].Id > result[j].Id
		})
	}

	if filter.UsePagination {
		offset := int((filter.Page - 1) * filter.PageSize)
		if offset < 0 {
			offset = 0
		}
		if offset >= len(result) {
			return []*entity.Message{}, false, nil
		}
		end := offset + int(filter.PageSize)
		hasMore := end < len(result)
		if end > len(result) {
			end = len(result)
		}
		return result[offset:end], hasMore, nil
	}

	return result, false, nil
}

func messageMatchesFilter(msg *entity.Message, filter *repository.MessageFilter) bool {
	if filter.Username != nil && msg.Username != *filter.Username {
		return false
	}
	if filter.ConversationId != nil && msg.ConversationId != *filter.ConversationId {
		return false
	}
	if filter.AgentInstanceId != nil && msg.AgentInstanceId != *filter.AgentInstanceId {
		return false
	}
	if filter.TurnId != nil && msg.TurnId != *filter.TurnId {
		return false
	}
	if filter.Role != nil && msg.Role != *filter.Role {
		return false
	}
	if len(filter.ContentTypeList) > 0 && !slices.Contains(filter.ContentTypeList, msg.ContentType) {
		return false
	}
	return true
}

func (m *mockMessageRepo) ListByConversationPage(
	_ context.Context, conversationID int64,
	page, pageSize int32,
) ([]*entity.Message, bool, error) {
	var result []*entity.Message
	for _, msg := range m.messages {
		if msg.ConversationId == conversationID {
			result = append(result, proto.Clone(msg).(*entity.Message))
		}
	}
	offset := int((page - 1) * pageSize)
	if offset < 0 {
		offset = 0
	}
	if offset >= len(result) {
		return []*entity.Message{}, false, nil
	}
	end := offset + int(pageSize)
	hasMore := end < len(result)
	if end > len(result) {
		end = len(result)
	}
	return result[offset:end], hasMore, nil
}

func (m *mockMessageRepo) GetUserMessageByConversationTurnID(
	_ context.Context, conversationID int64, turnID int64,
) (*entity.Message, error) {
	for _, msg := range m.messages {
		if msg.ConversationId == conversationID && msg.TurnId == turnID && msg.Role == "user" {
			return proto.Clone(msg).(*entity.Message), nil
		}
	}
	return nil, nil
}
