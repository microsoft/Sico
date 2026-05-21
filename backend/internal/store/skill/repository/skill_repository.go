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

	"sico-backend/internal/store/skill/internal/dal"
	skillModel "sico-backend/internal/store/skill/internal/dal/model"
)

// SkillModel is an alias for the generated GORM model.
type SkillModel = skillModel.TSkill

// SkillFilter represents query filters for listing skills.
type SkillFilter = dal.SkillFilter

// SkillRepository defines data access for skills.
type SkillRepository interface {
	Create(ctx context.Context, s *SkillModel) (int64, error)
	Update(ctx context.Context, s *SkillModel) error
	GetByID(ctx context.Context, id int64) (*SkillModel, error)
	List(ctx context.Context, filter *SkillFilter) ([]*SkillModel, int64, error)
	Delete(ctx context.Context, id int64) error
}

func NewSkillRepo(db *gorm.DB) SkillRepository {
	return dal.NewSkillDAO(db)
}
