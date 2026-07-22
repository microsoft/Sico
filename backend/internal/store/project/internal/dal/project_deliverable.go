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

package dal

import (
	"context"

	"sico-backend/internal/store/project/internal/dal/model"
)

func (dao *ProjectDAO) CreateProjectDeliverable(ctx context.Context, record *model.TProjectDeliverable) (int64, error) {
	err := dao.query.TProjectDeliverable.WithContext(ctx).Create(record)
	if err != nil {
		return 0, err
	}
	return record.ID, nil
}

func (dao *ProjectDAO) GetProjectDeliverable(ctx context.Context, id int64) (*model.TProjectDeliverable, error) {
	return dao.query.TProjectDeliverable.WithContext(ctx).
		Where(dao.query.TProjectDeliverable.ID.Eq(id)).
		First()
}

func (dao *ProjectDAO) ListProjectDeliverables(
	ctx context.Context, projectID int64, offset, limit int,
) ([]*model.TProjectDeliverable, int64, error) {
	q := dao.query.TProjectDeliverable.WithContext(ctx).
		Where(dao.query.TProjectDeliverable.ProjectID.Eq(projectID)).
		Order(dao.query.TProjectDeliverable.CreatedAt.Desc())

	total, err := q.Count()
	if err != nil {
		return nil, 0, err
	}

	q = q.Offset(offset)
	if limit > 0 {
		q = q.Limit(limit)
	}

	records, err := q.Find()
	if err != nil {
		return nil, 0, err
	}

	return records, total, nil
}

func (dao *ProjectDAO) DeleteProjectDeliverable(ctx context.Context, id int64) error {
	q := dao.query.TProjectDeliverable
	_, err := q.WithContext(ctx).Where(q.ID.Eq(id)).Delete()
	return err
}
