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

	"sico-backend/internal/store/rbac/internal/dal"
	"sico-backend/internal/store/rbac/internal/dal/model"
)

type PolicyModel = model.TCasbinRule

type CasbinRuleRepository interface {
	Create(ctx context.Context, rule *PolicyModel) error
	Update(ctx context.Context, rule *PolicyModel) error
	Delete(ctx context.Context, id int64) error
	Get(ctx context.Context, id int64) (*PolicyModel, error)
	GetByRule(ctx context.Context, ptype string, rule []string) (*PolicyModel, error)
	Query(ctx context.Context, ptype, v0, v1, v2 string, page, pageSize int32) ([]*PolicyModel, int64, error)
}

func NewCasbinRuleRepository(db *gorm.DB) CasbinRuleRepository {
	return dal.NewCasbinRuleDAO(db)
}
