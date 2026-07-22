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

package repository

import (
	"context"

	"gorm.io/gorm"

	entity "sico-backend/internal/entity/conversation/conversation"
	"sico-backend/internal/infra/idgen"
	"sico-backend/internal/store/conversation/conversation/internal/dal"
)

func NewConversationRepo(db *gorm.DB, idGen idgen.IDGenerator) ConversationRepo {
	return dal.NewConversationDAO(db, idGen)
}

type ConversationRepo interface {
	Create(ctx context.Context, msg *entity.Conversation) (*entity.Conversation, error)
	Update(ctx context.Context, msg *entity.Conversation) error
	UpdateTitleIfCurrent(ctx context.Context, id int64, currentTitle, nextTitle string) (int64, error)
	GetByID(ctx context.Context, id int64) (*entity.Conversation, error)
	Get(ctx context.Context, username string, agentID string, agentInstanceID int64) (*entity.Conversation, error)
	Delete(ctx context.Context, id int64) (int64, error)
	List(
		ctx context.Context,
		username string, agentID string, agentInstanceID int64,
		limit int, page int,
	) ([]*entity.Conversation, bool, error)
}
