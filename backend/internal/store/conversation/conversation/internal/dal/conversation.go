package dal

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"

	entity "sico-backend/internal/entity/conversation/conversation"
	"sico-backend/internal/infra/idgen"
	"sico-backend/internal/store/conversation/conversation/internal/dal/model"
	"sico-backend/internal/store/conversation/conversation/internal/dal/query"
	"sico-backend/pkg/slicesx"
)

type ConversationDAO struct {
	db    *gorm.DB
	query *query.Query
}

func NewConversationDAO(db *gorm.DB, generator idgen.IDGenerator) *ConversationDAO {
	return &ConversationDAO{
		db:    db,
		query: query.Use(db),
	}
}

func (dao *ConversationDAO) Create(ctx context.Context, msg *entity.Conversation) (*entity.Conversation, error) {
	poData := dao.conversationDO2PO(msg)

	err := dao.query.TConversation.WithContext(ctx).Create(poData)
	if err != nil {
		return nil, err
	}
	return dao.conversationPO2DO(poData), nil
}

func (dao *ConversationDAO) Update(ctx context.Context, msg *entity.Conversation) error {
	poData := dao.conversationDO2PO(msg)
	table := dao.query.TConversation
	_, err := table.WithContext(ctx).Where(table.ID.Eq(poData.ID)).Updates(poData)

	return err
}

func (dao *ConversationDAO) UpdateTitleIfCurrent(ctx context.Context, id int64, currentTitle, nextTitle string) (int64, error) {
	table := dao.query.TConversation
	result, err := table.WithContext(ctx).
		Where(table.ID.Eq(id)).
		Where(table.Title.Eq(currentTitle)).
		Where(table.DeletedAt.IsNull()).
		Update(table.Title, nextTitle)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected, nil
}

func (dao *ConversationDAO) GetByID(ctx context.Context, id int64) (*entity.Conversation, error) {
	poData, err := dao.query.TConversation.WithContext(ctx).Debug().Where(dao.query.TConversation.ID.Eq(id)).First()
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}

	if err != nil {
		return nil, err
	}
	return dao.conversationPO2DO(poData), nil
}

func (dao *ConversationDAO) Delete(ctx context.Context, id int64) (int64, error) {
	updateRes, err := dao.query.TConversation.WithContext(ctx).Where(dao.query.TConversation.ID.Eq(id)).Delete()
	if err != nil {
		return 0, err
	}
	return updateRes.RowsAffected, err
}

func (dao *ConversationDAO) Get(
	ctx context.Context,
	username string, agentID string, agentInstanceID int64,
) (*entity.Conversation, error) {
	queryBuilder := dao.query.TConversation.WithContext(ctx).Debug().
		Where(dao.query.TConversation.CreatorUsername.Eq(username)).
		Where(dao.query.TConversation.AgentInstanceID.Eq(agentInstanceID))

	if agentID != "" {
		queryBuilder = queryBuilder.Where(dao.query.TConversation.AgentID.Eq(agentID))
	}

	queryBuilder = queryBuilder.
		Where(dao.query.TConversation.DeletedAt.IsNull()).
		Order(dao.query.TConversation.CreatedAt.Desc())

	po, err := queryBuilder.First()

	if err != nil && errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return dao.conversationPO2DO(po), nil
}

func (dao *ConversationDAO) List(
	ctx context.Context,
	username string, agentID string, agentInstanceID int64,
	limit int, page int,
) ([]*entity.Conversation, bool, error) {
	var hasMore bool

	do := dao.query.TConversation.WithContext(ctx).Debug()
	do = do.Where(dao.query.TConversation.DeletedAt.IsNull())
	if agentInstanceID > 0 {
		do = do.Where(dao.query.TConversation.AgentInstanceID.Eq(agentInstanceID))
	}
	if agentID != "" {
		do = do.Where(dao.query.TConversation.AgentID.Eq(agentID))
	}
	if limit > 0 {
		do = do.Limit(int(limit) + 1)
	}

	do = do.Where(dao.query.TConversation.CreatorUsername.Eq(username))
	do = do.Order(dao.query.TConversation.CreatedAt.Desc())
	do = do.Offset((page - 1) * limit)

	poList, err := do.Find()

	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, hasMore, nil
	}
	if err != nil {
		return nil, hasMore, err
	}

	if len(poList) == 0 {
		return nil, hasMore, nil
	}
	if len(poList) > limit {
		hasMore = true
		return dao.conversationBatchPO2DO(poList[:(len(poList) - 1)]), hasMore, nil

	}
	return dao.conversationBatchPO2DO(poList), hasMore, nil
}

func (dao *ConversationDAO) conversationDO2PO(conversation *entity.Conversation) *model.TConversation {
	return &model.TConversation{
		ID:              conversation.ID,
		AgentID:         conversation.AgentID,
		AgentInstanceID: conversation.AgentInstanceID,
		CreatorUsername: conversation.CreatorUsername,
		Title:           conversation.Title,
		Ext:             conversation.Ext,
		CreatedAt:       time.Now().UnixMilli(),
		UpdatedAt:       time.Now().UnixMilli(),
	}
}

func (dao *ConversationDAO) conversationPO2DO(c *model.TConversation) *entity.Conversation {
	return &entity.Conversation{
		ID:              c.ID,
		AgentID:         c.AgentID,
		AgentInstanceID: c.AgentInstanceID,
		Title:           c.Title,
		CreatorUsername: c.CreatorUsername,
		Ext:             c.Ext,
		CreatedAt:       c.CreatedAt,
		UpdatedAt:       c.UpdatedAt,
	}
}

func (dao *ConversationDAO) conversationBatchPO2DO(conversations []*model.TConversation) []*entity.Conversation {
	return slicesx.Transform(conversations, func(c *model.TConversation) *entity.Conversation {
		return &entity.Conversation{
			ID:              c.ID,
			Title:           c.Title,
			AgentID:         c.AgentID,
			AgentInstanceID: c.AgentInstanceID,
			CreatorUsername: c.CreatorUsername,
			Ext:             c.Ext,
			CreatedAt:       c.CreatedAt,
			UpdatedAt:       c.UpdatedAt,
		}
	})
}
