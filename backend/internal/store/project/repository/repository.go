package repository

import (
	"context"

	"gorm.io/gorm"

	"sico-backend/internal/store/project/internal/dal"
	"sico-backend/internal/store/project/internal/dal/model"
)

type ProjectModel = model.TProject
type ProjectFilter = dal.ProjectFilter
type ProjectAssetModel = model.TProjectAsset
type ProjectDeliverableModel = model.TProjectDeliverable

func NewProjectRepo(db *gorm.DB) ProjectRepository {
	return WithTracingProjectRepository(dal.NewProjectDAO(db))
}

type ProjectRepository interface {
	CreateProject(ctx context.Context, project *model.TProject) error
	DeleteProject(ctx context.Context, projectID int64) error
	UpdateProject(ctx context.Context, project *model.TProject) error
	UpdateProjectFields(ctx context.Context, projectID int64, fields map[string]interface{}) error
	GetProjectByID(ctx context.Context, projectID int64) (*model.TProject, error)
	GetProjectByIDs(ctx context.Context, projectIDs []int64) ([]*model.TProject, error)
	AddProjectAsset(ctx context.Context, projectAsset *model.TProjectAsset) (int64, error)
	DeleteProjectAsset(ctx context.Context, id int64) error
	GetUserProjectAssetList(ctx context.Context, username, projectID string) ([]*model.TProjectAsset, error)
	GetUserProjectAssetListWithPagination(
		ctx context.Context, username, projectID string, page, pageSize int32) ([]*model.TProjectAsset, int64, error)
	GetProjectAssetList(ctx context.Context, projectID string) ([]*model.TProjectAsset, error)
	GetProjectAsset(ctx context.Context, id int64) (*model.TProjectAsset, error)
	GetProjectAssetByObjectKey(ctx context.Context, projectID, objectKey string) (*model.TProjectAsset, error)
	GetProjectAssetListWithPagination(
		ctx context.Context, projectID string, page, pageSize int32) ([]*model.TProjectAsset, int64, error)
	CreateProjectDeliverable(ctx context.Context, record *model.TProjectDeliverable) (int64, error)
	GetProjectDeliverable(ctx context.Context, id int64) (*model.TProjectDeliverable, error)
	ListProjectDeliverables(
		ctx context.Context, projectID int64, offset, limit int,
	) ([]*model.TProjectDeliverable, int64, error)
	DeleteProjectDeliverable(ctx context.Context, id int64) error
	ListProjects(ctx context.Context, filter *ProjectFilter, offset, limit int) ([]*ProjectModel, int64, error)
}
