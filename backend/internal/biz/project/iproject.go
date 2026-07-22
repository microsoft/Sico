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

package project

import (
	"context"
	"mime/multipart"

	"sico-backend/internal/shared/types"
	"sico-backend/internal/transport/http/dto/project"
)

// Service exposes project-related business capabilities consumed by transports.
type Service interface {
	CreateProject(
		ctx context.Context,
		req *project.CreateProjectRequest,
		creator string,
	) (*project.CreateProjectResponse, error)
	UpdateProject(
		ctx context.Context,
		req *project.UpdateProjectRequest,
	) (*project.UpdateProjectResponse, error)
	DeleteProject(
		ctx context.Context,
		req *project.DeleteProjectRequest,
	) (*project.DeleteProjectResponse, error)
	GetProject(
		ctx context.Context,
		req *project.GetProjectDetailRequest,
	) (*project.GetProjectDetailResponse, error)
	GetUserProjectList(
		ctx context.Context,
		req *project.GetUserProjectListRequest,
	) (*project.GetUserProjectListResponse, error)
	AddProjectAsset(
		ctx context.Context,
		req *project.AddProjectAssetRequest,
		creator string,
		file multipart.File,
		fileExtra FileExtraInfo,
	) (*project.AddProjectAssetResponse, error)
	DeleteProjectAsset(
		ctx context.Context,
		req *project.DeleteProjectAssetRequest,
	) (*project.DeleteProjectAssetResponse, error)
	GetProjectAssetList(
		ctx context.Context,
		req *project.GetProjectAssetListRequest,
	) (*project.GetProjectAssetListResponse, error)
	GetProjectSASAsset(
		ctx context.Context,
		req *project.GetProjectSASAssetRequest,
	) (*project.GetProjectSASAssetResponse, error)
	QueryProjectStatistics(
		ctx context.Context,
		req *project.QueryProjectStatisticsRequest,
	) (*project.QueryProjectStatisticsResponse, error)
	CreateProjectDeliverable(
		ctx context.Context,
		req *project.CreateProjectDeliverableRequest,
		creator string,
	) (*project.CreateProjectDeliverableResponse, error)
	ListProjectDeliverables(
		ctx context.Context,
		req *project.ListProjectDeliverablesRequest,
	) (*project.ListProjectDeliverablesResponse, error)
	GetProjectDeliverable(
		ctx context.Context,
		req *project.GetProjectDeliverableRequest,
	) (*project.GetProjectDeliverableResponse, error)
	DeleteProjectDeliverable(
		ctx context.Context,
		req *project.DeleteProjectDeliverableRequest,
	) (*project.DeleteProjectDeliverableResponse, error)
	ListProjects(
		ctx context.Context,
		req *project.ListProjectFilter,
	) (*project.ListProjectResponse, error)
}

// FileExtraInfo describes additional metadata persisted alongside project assets.
type FileExtraInfo = types.FileExtraInfo
