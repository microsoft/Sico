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

	entity "sico-backend/internal/entity/agent/singleagent"
	"sico-backend/internal/store/agent/singleagent/internal/dal"
)

func NewSingleAgentInstanceRepo(db *gorm.DB) SingleAgentInstanceRepository {
	return dal.NewSingleAgentInstanceDAO(db)
}

type SingleAgentInstanceRepository interface {
	Create(ctx context.Context, instance *entity.SingleAgentInstance) (int64, error)
	Get(ctx context.Context, id int64) (*entity.SingleAgentInstance, error)
	MGet(ctx context.Context, ids []int64) ([]*entity.SingleAgentInstance, error)
	GetNamesByIDs(ctx context.Context, ids []int64) (map[int64]string, error)
	Update(ctx context.Context, instance *entity.SingleAgentInstance) error
	Delete(ctx context.Context, id int64) error
	ListByOperatorUsername(
		ctx context.Context,
		operatorUsername string, offset, limit int,
	) ([]*entity.SingleAgentInstance, error)
	CountByOperatorUsername(ctx context.Context, operatorUsername string) (int64, error)
	ListByCondition(
		ctx context.Context,
		isEmployer bool, username string,
		offset, limit int,
	) ([]*entity.SingleAgentInstance, error)
	CountByCondition(
		ctx context.Context,
		isEmployer bool, username string,
	) (int64, error)
	ListByFilter(
		ctx context.Context,
		filter *entity.ListSingleAgentInstanceFilter,
		offset, limit int,
	) ([]*entity.SingleAgentInstance, int64, error)
	CountByAgentID(ctx context.Context, agentID string) (int64, error)
}
