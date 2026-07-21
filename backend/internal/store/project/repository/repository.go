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

	"sico-backend/internal/store/project/internal/dal"
	"sico-backend/internal/store/project/internal/dal/model"
)

type ProjectModel = model.TProject
type ProjectFilter = dal.ProjectFilter
type ProjectUserModel = model.TProjectUser
type ProjectAssetModel = model.TProjectAsset
type ProjectDeliverableModel = model.TProjectDeliverable

func NewProjectRepo(db *gorm.DB) ProjectRepository {
	return dal.NewProjectDAO(db)
}

type ProjectRepository interface {
	CreateProject(ctx context.Context, project *model.TProject) error
	DeleteProject(ctx context.Context, projectID int64) error
	UpdateProject(ctx context.Context, project *model.TProject) error
	UpdateProjectFields(ctx context.Context, projectID int64, fields map[string]interface{}) error
	GetProjectByID(ctx context.Context, projectID int64) (*model.TProject, error)
	GetProjectByIDs(ctx context.Context, projectIDs []int64) ([]*model.TProject, error)
	GetProjectIDsByAdminUsername(ctx context.Context, username string) ([]int64, error)
	GetProjectAdminUsernames(ctx context.Context, projectIDs []int64) (map[int64][]string, error)
	DeleteProjectAdmins(ctx context.Context, projectID int64) error
	DeleteProjectAdminsByUsernames(ctx context.Context, projectID int64, usernames []string) error
	AddProjectAdminsByUsernames(ctx context.Context, projectID int64, usernames []string) error
	AddProjectUser(ctx context.Context, project *model.TProjectUser) error
	DeleteProjectUsers(ctx context.Context, projectID int64) error
	GetUserProjectList(ctx context.Context, username string) ([]*model.TProjectUser, error)
	GetUserProjectListWithPagination(
		ctx context.Context,
		username string, memberType int32,
		page, pageSize int32,
	) ([]*model.TProjectUser, int64, error)
	AddProjectAsset(ctx context.Context, projectAsset *model.TProjectAsset) (int64, error)
	DeleteProjectAsset(ctx context.Context, id int64) error
	GetUserProjectAssetList(ctx context.Context, username, projectID string) ([]*model.TProjectAsset, error)
	GetUserProjectAssetListWithPagination(
		ctx context.Context, username, projectID string, page, pageSize int32) ([]*model.TProjectAsset, int64, error)
	GetProjectAssetList(ctx context.Context, projectID string) ([]*model.TProjectAsset, error)
	GetProjectAsset(ctx context.Context, id int64) (*model.TProjectAsset, error)
	GetProjectAssetListWithPagination(
		ctx context.Context, projectID string, page, pageSize int32) ([]*model.TProjectAsset, int64, error)
	CreateProjectDeliverable(ctx context.Context, record *model.TProjectDeliverable) (int64, error)
	GetProjectDeliverable(ctx context.Context, id int64) (*model.TProjectDeliverable, error)
	ListProjectDeliverables(
		ctx context.Context, projectID int64, offset, limit int,
	) ([]*model.TProjectDeliverable, int64, error)
	DeleteProjectDeliverable(ctx context.Context, id int64) error
	ListProjectMemberUsernames(ctx context.Context, projectID int64) ([]string, error)
	ListProjects(ctx context.Context, filter *ProjectFilter, offset, limit int) ([]*ProjectModel, int64, error)
}
