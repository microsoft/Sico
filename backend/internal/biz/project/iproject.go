package project

import (
	"context"
	"io"

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
		file io.Reader,
		fileExtra FileExtraInfo,
	) (*project.AddProjectAssetResponse, error)
	CreateProjectAssetUploadURL(
		ctx context.Context,
		req *project.CreateProjectAssetUploadURLRequest,
		fileExtra FileExtraInfo,
	) (*project.CreateProjectAssetUploadURLResponse, error)
	CompleteProjectAssetUpload(
		ctx context.Context,
		req *project.CompleteProjectAssetUploadRequest,
		creator string,
		fileExtra FileExtraInfo,
	) (*project.CompleteProjectAssetUploadResponse, error)
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
