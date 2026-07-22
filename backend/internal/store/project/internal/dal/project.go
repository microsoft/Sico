package dal

import (
	"context"

	"gorm.io/gorm"

	"sico-backend/internal/store/project/internal/dal/model"
	"sico-backend/internal/store/project/internal/dal/query"
)

type ProjectDAO struct {
	query *query.Query
}

func NewProjectDAO(db *gorm.DB) *ProjectDAO {
	return &ProjectDAO{
		query: query.Use(db),
	}
}

func (dao *ProjectDAO) CreateProject(ctx context.Context, project *model.TProject) error {
	return dao.query.TProject.WithContext(ctx).Create(project)
}

func (dao *ProjectDAO) DeleteProject(ctx context.Context, projectID int64) error {
	dam := dao.query.TProject
	_, err := dam.WithContext(ctx).Where(dam.ID.Eq(projectID)).Delete()

	return err
}

func (dao *ProjectDAO) UpdateProject(ctx context.Context, project *model.TProject) error {
	dam := dao.query.TProject
	_, err := dam.WithContext(ctx).Where(dam.ID.Eq(project.ID)).Updates(project)
	if err != nil {
		return err
	}

	return nil
}

func (dao *ProjectDAO) UpdateProjectFields(ctx context.Context, projectID int64, fields map[string]interface{}) error {
	dam := dao.query.TProject
	_, err := dam.WithContext(ctx).Where(dam.ID.Eq(projectID)).Updates(fields)
	if err != nil {
		return err
	}

	return nil
}

func (dao *ProjectDAO) GetProjectByID(ctx context.Context, projectID int64) (*model.TProject, error) {
	return dao.query.TProject.WithContext(ctx).Where(
		dao.query.TProject.ID.Eq(projectID),
	).First()
}

func (dao *ProjectDAO) GetProjectByIDs(ctx context.Context, projectIDs []int64) ([]*model.TProject, error) {
	return dao.query.TProject.WithContext(ctx).Where(
		dao.query.TProject.ID.In(projectIDs...),
	).Find()
}

// ProjectFilter defines fields for filtering projects.
type ProjectFilter struct {
	OrganizationID  *int64
	CreatorUsername *string
	OwnerUsername   *string
}

func (dao *ProjectDAO) ListProjects(
	ctx context.Context, filter *ProjectFilter, offset, limit int,
) ([]*model.TProject, int64, error) {
	t := dao.query.TProject
	q := t.WithContext(ctx)

	if filter != nil {
		if filter.OrganizationID != nil {
			q = q.Where(t.OrganizationID.Eq(*filter.OrganizationID))
		}
		if filter.CreatorUsername != nil {
			q = q.Where(t.CreatorUsername.Eq(*filter.CreatorUsername))
		}
		if filter.OwnerUsername != nil {
			q = q.Where(t.OwnerUsername.Eq(*filter.OwnerUsername))
		}
	}

	count, err := q.Count()
	if err != nil {
		return nil, 0, err
	}

	q = q.Order(t.ID.Desc()).Offset(offset)
	if limit > 0 {
		q = q.Limit(limit)
	}

	projects, err := q.Find()
	if err != nil {
		return nil, 0, err
	}

	return projects, count, nil
}
