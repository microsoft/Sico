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
