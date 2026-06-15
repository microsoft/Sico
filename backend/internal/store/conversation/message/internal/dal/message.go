package dal

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"

	entity "sico-backend/internal/entity/conversation/message"
	"sico-backend/internal/store/conversation/message/internal/dal/model"
	"sico-backend/internal/store/conversation/message/internal/dal/query"
	convdto "sico-backend/internal/transport/http/dto/conversation"
)

type MessageFilter struct {
	Username        *string
	ConversationId  *int64
	AgentInstanceId *int64
	TurnId          *int64
	Role            *string
	ContentTypeList []convdto.ChatContentType
	IdDescending    bool
	UsePagination   bool
	Page            int32
	PageSize        int32
}

type MessageDAO struct {
	query *query.Query
}

func NewMessageDAO(db *gorm.DB) *MessageDAO {
	return &MessageDAO{query: query.Use(db)}
}

func (dao *MessageDAO) Create(ctx context.Context, msg *entity.Message) (*entity.Message, error) {
	po, err := dao.messageDO2PO(msg)
	if err != nil {
		return nil, err
	}
	m := dao.query.TMessage
	if err := m.WithContext(ctx).Debug().Omit(m.TaskRuntimeRecoveryKey).Create(po); err != nil {
		return nil, err
	}
	return dao.messagePO2DO(po), nil
}

func (dao *MessageDAO) GetLatestTurnID(ctx context.Context, conversationID int64) (int64, error) {
	if conversationID == 0 {
		return 0, nil
	}

	m := dao.query.TMessage
	res, err := m.WithContext(ctx).
		Select(m.TurnID).
		Where(m.ConversationID.Eq(conversationID)).
		Order(m.TurnID.Desc()).
		Limit(1).
		First()

	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, nil
		}
		return 0, err
	}

	return res.TurnID, nil
}

func (dao *MessageDAO) ListByFilter(ctx context.Context, filter *MessageFilter) ([]*entity.Message, bool, error) {
	m := dao.query.TMessage
	q := dao.applyMessageFilter(ctx, filter)

	hasMore := false
	if filter.UsePagination {
		if filter.Page < 1 {
			filter.Page = 1
		}
		if filter.PageSize < 1 {
			filter.PageSize = 10
		}
		offset := int((filter.Page - 1) * filter.PageSize)
		limit := int(filter.PageSize) + 1
		q = q.Offset(offset).Limit(limit)
	}

	pos, err := q.Order(m.TurnID.Desc(), m.ID.Desc()).Find()

	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, false, nil
		}
		return nil, false, err
	}

	res := make([]*entity.Message, 0, len(pos))
	for _, po := range pos {
		res = append(res, dao.messagePO2DO(po))
	}

	if filter.UsePagination && len(res) > int(filter.PageSize) {
		hasMore = true
		res = res[:filter.PageSize]
	}

	return res, hasMore, nil
}

func (dao *MessageDAO) applyMessageFilter(ctx context.Context, filter *MessageFilter) query.ITMessageDo {
	m := dao.query.TMessage
	q := m.WithContext(ctx)

	if filter.Username != nil {
		q = q.Where(m.Username.Eq(*filter.Username))
	}
	if filter.ConversationId != nil {
		q = q.Where(m.ConversationID.Eq(*filter.ConversationId))
	}
	if filter.AgentInstanceId != nil {
		q = q.Where(m.AgentInstanceID.Eq(*filter.AgentInstanceId))
	}
	if filter.TurnId != nil {
		q = q.Where(m.TurnID.Eq(*filter.TurnId))
	}
	if filter.Role != nil {
		q = q.Where(m.Role.Eq(*filter.Role))
	}
	if len(filter.ContentTypeList) > 0 {
		contentTypes := make([]int32, 0, len(filter.ContentTypeList))
		for _, ct := range filter.ContentTypeList {
			contentTypes = append(contentTypes, int32(ct))
		}
		q = q.Where(m.ContentType.In(contentTypes...))
	}
	if filter.IdDescending {
		q = q.Order(m.ID.Desc())
	}

	return q
}

func (dao *MessageDAO) ListByConversationPage(
	ctx context.Context, conversationID int64,
	page, pageSize int32,
) ([]*entity.Message, bool, error) {
	if conversationID == 0 {
		return nil, false, nil
	}

	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 10
	}

	m := dao.query.TMessage
	offset := int((page - 1) * pageSize)
	turnLimit := int(pageSize) + 1
	turnIDs := make([]int64, 0, turnLimit)

	if err := m.WithContext(ctx).
		Where(m.ConversationID.Eq(conversationID)).
		Distinct(m.TurnID).
		Order(m.TurnID.Desc()).
		Offset(offset).
		Limit(turnLimit).
		Pluck(m.TurnID, &turnIDs); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, false, nil
		}
		return nil, false, err
	}

	if len(turnIDs) == 0 {
		return nil, false, nil
	}

	hasMore := false
	if len(turnIDs) > int(pageSize) {
		hasMore = true
		turnIDs = turnIDs[:pageSize]
	}

	pos, err := m.WithContext(ctx).
		Where(
			m.ConversationID.Eq(conversationID),
			m.TurnID.In(turnIDs...),
		).
		Order(m.TurnID.Desc(), m.ID.Desc()).
		Find()
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, false, nil
		}
		return nil, false, err
	}

	res := make([]*entity.Message, 0, len(pos))
	for _, po := range pos {
		res = append(res, dao.messagePO2DO(po))
	}

	return res, hasMore, nil
}

func (dao *MessageDAO) GetUserMessageByConversationTurnID(
	ctx context.Context, conversationID int64, turnID int64,
) (*entity.Message, error) {
	if conversationID == 0 || turnID == 0 {
		return nil, nil
	}

	role := "user"
	results, _, err := dao.ListByFilter(ctx, &MessageFilter{
		ConversationId: &conversationID,
		TurnId:         &turnID,
		Role:           &role,
		IdDescending:   true,
	})

	if err != nil {
		return nil, err
	}

	if len(results) == 0 {
		return nil, nil
	}

	return results[0], nil
}

func (dao *MessageDAO) messageDO2PO(msg *entity.Message) (*model.TMessage, error) {
	now := time.Now().UnixMilli()
	createdAt := msg.CreatedAt
	if createdAt == 0 {
		createdAt = now
	}
	updatedAt := msg.UpdatedAt
	if updatedAt == 0 {
		updatedAt = now
	}

	return &model.TMessage{
		ID:              msg.Id,
		TurnID:          msg.TurnId,
		ConversationID:  msg.ConversationId,
		Username:        msg.Username,
		AgentInstanceID: msg.AgentInstanceId,
		Role:            msg.Role,
		ContentType:     int32(msg.ContentType),
		Content:         msg.Content,
		FunctionContext: msg.FunctionContext,
		Ext:             msg.Ext,
		Attachments:     msg.Attachments,
		CreatedAt:       createdAt,
		UpdatedAt:       updatedAt,
	}, nil
}

func (dao *MessageDAO) messagePO2DO(po *model.TMessage) *entity.Message {
	if po == nil {
		return nil
	}

	msg := &entity.Message{
		Id:              po.ID,
		TurnId:          po.TurnID,
		ConversationId:  po.ConversationID,
		Username:        po.Username,
		AgentInstanceId: po.AgentInstanceID,
		Role:            po.Role,
		ContentType:     convdto.ChatContentType(po.ContentType),
		Content:         po.Content,
		FunctionContext: po.FunctionContext,
		Ext:             po.Ext,
		Attachments:     po.Attachments,
		CreatedAt:       po.CreatedAt,
		UpdatedAt:       po.UpdatedAt,
	}

	return msg
}
