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

package impl

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"strconv"

	"gorm.io/gorm"

	singleAgentService "sico-backend/internal/biz/agent"
	appresp "sico-backend/internal/biz/common/response"
	singleAgentEntity "sico-backend/internal/entity/agent/singleagent"
	"sico-backend/internal/infra/idgen"
	"sico-backend/internal/infra/storage"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/errcode"
	"sico-backend/internal/shared/types"
	"sico-backend/internal/store/project/repository"
	projectdto "sico-backend/internal/transport/http/dto/project"
	"sico-backend/pkg/logger"
	"sico-backend/pkg/slicesx"
)

// Components gathers dependencies required by the project service implementation.
type Components struct {
	ProjectRepo repository.ProjectRepository
	IDGen       idgen.IDGenerator
	BlobClient  storage.Storage
}

// Service provides project-related business operations.
type Service struct {
	*Components
}

// FileExtraInfo holds metadata that accompanies uploaded project assets.
type FileExtraInfo = types.FileExtraInfo

// NewService constructs a new project service implementation.
func NewService(c *Components) *Service {
	return &Service{Components: c}
}

// CreateProject creates a new project owned by the given creator.
func (s *Service) CreateProject(
	ctx context.Context, req *projectdto.CreateProjectRequest, creator string,
) (*projectdto.CreateProjectResponse, error) {
	projectID, err := s.doCreateProject(ctx, req, creator)
	if err != nil {
		return nil, err
	}

	return appresp.Success(&projectdto.CreateProjectResponse{
		Data: &projectdto.CreateProjectData{Id: projectID},
	}), nil
}

// UpdateProject updates mutable project fields.
func (s *Service) UpdateProject(
	ctx context.Context, req *projectdto.UpdateProjectRequest,
) (*projectdto.UpdateProjectResponse, error) {
	if err := s.doUpdateProject(ctx, req); err != nil {
		return nil, err
	}

	return appresp.Success(&projectdto.UpdateProjectResponse{}), nil
}

// DeleteProject removes the project and associated members.
func (s *Service) DeleteProject(
	ctx context.Context, req *projectdto.DeleteProjectRequest,
) (*projectdto.DeleteProjectResponse, error) {
	if err := s.doDeleteProject(ctx, req.Id); err != nil {
		return nil, err
	}

	return appresp.Success(&projectdto.DeleteProjectResponse{}), nil
}

// GetUserProjectList lists projects the current user participates in.
func (s *Service) GetUserProjectList(
	ctx context.Context, req *projectdto.GetUserProjectListRequest,
) (*projectdto.GetUserProjectListResponse, error) {
	projects, total, hasNext, err := s.doGetUserProjectList(ctx, req)
	if err != nil {
		return nil, err
	}

	return appresp.Success(&projectdto.GetUserProjectListResponse{
		Data: &projectdto.GetUserProjectListData{
			Projects: projects,
			Total:    int32(total),
			HasNext:  hasNext,
		},
	}), nil
}

// GetProjectSASAsset .
func (s *Service) GetProjectSASAsset(
	ctx context.Context, req *projectdto.GetProjectSASAssetRequest,
) (*projectdto.GetProjectSASAssetResponse, error) {
	cdn, err := storage.PathToUrl(req.GetUri())
	if err != nil {
		return nil, err
	}

	return appresp.Success(&projectdto.GetProjectSASAssetResponse{
		Data: &projectdto.GetProjectSASAssetData{
			Uri:    req.GetUri(),
			SasUrl: cdn,
		},
	}), nil
}

// GetProject returns project details by id.
func (s *Service) GetProject(
	ctx context.Context, req *projectdto.GetProjectDetailRequest,
) (*projectdto.GetProjectDetailResponse, error) {
	if s == nil || s.ProjectRepo == nil {
		return nil, apperr.New(errcode.CommonUnavailable, "project service not initialized")
	}

	projectModel, err := s.ProjectRepo.GetProjectByID(ctx, req.Id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperr.New(errcode.CommonNotFound, "project not found")
		}
		return nil, err
	}

	projectDTO := projectModelToDTO(projectModel)

	if admins, err := s.ProjectRepo.GetProjectAdminUsernames(ctx, []int64{projectModel.ID}); err == nil {
		projectDTO.OperatorAdmins = admins[projectModel.ID]
	}

	if instances := s.fetchProjectAgentInstances(ctx, []int64{projectModel.ID}); instances != nil {
		projectDTO.AgentInstances = instances[projectModel.ID]
	}

	if projectModel.IconURI != "" {
		sasURL, err := storage.PathToUrl(projectModel.IconURI)
		if err != nil {
			logger.CtxError(
				ctx,
				"failed to convert project icon uri to CDN: projectId=%d, uri=%s, err=%v",
				projectModel.ID, projectModel.IconURI, err,
			)
		} else {
			projectDTO.IconSasUrl = sasURL
		}
	}

	return appresp.Success(&projectdto.GetProjectDetailResponse{Data: projectDTO}), nil
}

// AddProjectAsset uploads a project asset and persists its metadata.
func (s *Service) AddProjectAsset(
	ctx context.Context,
	req *projectdto.AddProjectAssetRequest,
	creator string,
	file multipart.File,
	fileExtra FileExtraInfo,
) (*projectdto.AddProjectAssetResponse, error) {
	id, url, sasURL, meta, err := s.doAddProjectAsset(ctx, req, creator, file, fileExtra)
	if err != nil {
		return nil, err
	}

	return appresp.Success(&projectdto.AddProjectAssetResponse{
		Data: &projectdto.AddProjectAssetData{
			Id:       id,
			SasUrl:   sasURL,
			Uri:      url,
			MetaInfo: meta,
		},
	}), nil
}

// DeleteProjectAsset removes a project asset record.
func (s *Service) DeleteProjectAsset(
	ctx context.Context, req *projectdto.DeleteProjectAssetRequest,
) (*projectdto.DeleteProjectAssetResponse, error) {
	asset, err := s.ProjectRepo.GetProjectAsset(ctx, req.Id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperr.New(errcode.CommonNotFound, "project asset not found")
		}
		return nil, err
	}

	if err := s.ProjectRepo.DeleteProjectAsset(ctx, req.Id); err != nil {
		return nil, err
	}

	err = s.BlobClient.DelObjectByPath(ctx, fmt.Sprintf("%s/%s", asset.ProjectID, asset.ObjectKey))
	if err != nil {
		return nil, err
	}

	return appresp.Success(&projectdto.DeleteProjectAssetResponse{}), nil
}

// GetProjectAssetList returns paginated assets filtered by user and project.
func (s *Service) GetProjectAssetList(
	ctx context.Context, req *projectdto.GetProjectAssetListRequest,
) (*projectdto.GetProjectAssetListResponse, error) {
	assets, total, err := s.doGetUserProjectAssetList(ctx, req.Username, req.ProjectId, req.Page, req.PageSize)
	if err != nil {
		return nil, err
	}

	return appresp.Success(&projectdto.GetProjectAssetListResponse{
		Data: &projectdto.GetProjectAssetListData{
			Assets: assets,
			Total:  int32(total),
		},
	}), nil
}

func (s *Service) doCreateProject(
	ctx context.Context, req *projectdto.CreateProjectRequest, creator string,
) (int64, error) {
	if s == nil || s.Components == nil || s.ProjectRepo == nil {
		return 0, apperr.New(errcode.CommonUnavailable, "project service not initialized")
	}

	projectModel := &repository.ProjectModel{
		Name:            req.Name,
		Description:     req.Description,
		OwnerUsername:   creator,
		CreatorUsername: creator,
		IconURI:         req.IconUri,
	}

	if err := s.ProjectRepo.CreateProject(ctx, projectModel); err != nil {
		logger.CtxError(ctx, "failed to create project: name=%s, creator=%s, err=%v", req.Name, creator, err)
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return 0, apperr.New(errcode.CommonConflict, "project already exists")
		}
		return 0, err
	}

	membership := &repository.ProjectUserModel{
		ProjectID: projectModel.ID,
		Username:  creator,
		RoleType:  int32(projectdto.MemberType_MEMBER_TYPE_OWNER),
	}

	if err := s.ProjectRepo.AddProjectUser(ctx, membership); err != nil {
		logger.CtxError(
			ctx,
			"failed to add project owner: projectId=%d, creator=%s, err=%v",
			projectModel.ID, creator, err,
		)
		return 0, err
	}

	if err := s.ProjectRepo.AddProjectAdminsByUsernames(ctx, projectModel.ID, req.OperatorAdmins); err != nil {
		logger.CtxError(ctx, "failed to add project admins: projectId=%d, err=%v", projectModel.ID, err)
		return 0, err
	}

	return projectModel.ID, nil
}

func (s *Service) doUpdateProject(ctx context.Context, req *projectdto.UpdateProjectRequest) error {
	fields := make(map[string]interface{})
	if req.Name != "" {
		fields["name"] = req.Name
	}
	if req.Description != "" {
		fields["description"] = req.Description
	}
	if req.IconUri != "" {
		fields["icon_uri"] = req.IconUri
	}

	if err := s.ProjectRepo.UpdateProjectFields(ctx, req.Id, fields); err != nil {
		return err
	}

	if err := s.syncProjectAdmins(ctx, req.Id, req.OperatorAdmins); err != nil {
		return err
	}

	return nil
}

func (s *Service) doDeleteProject(ctx context.Context, projectID int64) error {
	if err := s.ProjectRepo.DeleteProject(ctx, projectID); err != nil {
		logger.CtxError(ctx, "failed to delete project: projectId=%d, err=%v", projectID, err)
		return err
	}
	if err := s.ProjectRepo.DeleteProjectUsers(ctx, projectID); err != nil {
		logger.CtxError(ctx, "failed to delete project users: projectId=%d, err=%v", projectID, err)
		return err
	}

	return nil
}

func (s *Service) doGetUserProjectList(
	ctx context.Context,
	req *projectdto.GetUserProjectListRequest,
) ([]*projectdto.Project, int64, bool, error) {
	userProjects, total, err := s.ProjectRepo.GetUserProjectListWithPagination(
		ctx, req.Username, int32(req.MemberType),
		req.Page, req.PageSize,
	)
	if err != nil {
		logger.CtxError(ctx, "failed to get user project list: username=%s, err=%v", req.Username, err)
		return nil, 0, false, err
	}

	if len(userProjects) == 0 {
		return []*projectdto.Project{}, total, false, nil
	}

	// De-duplicate project IDs so each project appears once in the response.
	projectIDs := make([]int64, 0, len(userProjects))
	membershipByProject := make(map[int64]*repository.ProjectUserModel, len(userProjects))
	for _, membership := range userProjects {
		if _, exists := membershipByProject[membership.ProjectID]; exists {
			continue
		}
		membershipByProject[membership.ProjectID] = membership
		projectIDs = append(projectIDs, membership.ProjectID)
	}

	projects, err := s.ProjectRepo.GetProjectByIDs(ctx, projectIDs)
	if err != nil {
		logger.CtxError(ctx, "failed to get projects by IDs: ids=%v, err=%v", projectIDs, err)
		return nil, 0, false, err
	}

	adminByProject, err := s.ProjectRepo.GetProjectAdminUsernames(ctx, projectIDs)
	if err != nil {
		logger.CtxError(ctx, "failed to get project admins: ids=%v, err=%v", projectIDs, err)
		return nil, 0, false, err
	}

	agentInstancesByProject := s.fetchProjectAgentInstances(ctx, projectIDs)

	result := slicesx.Transform(projects, func(po *repository.ProjectModel) *projectdto.Project {
		projectDTO := projectModelToDTO(po)
		if membership, ok := membershipByProject[po.ID]; ok {
			projectDTO.MemberType = projectdto.MemberType(membership.RoleType)
		}
		if admins, ok := adminByProject[po.ID]; ok {
			projectDTO.OperatorAdmins = admins
		} else {
			projectDTO.OperatorAdmins = []string{}
		}
		if instances, ok := agentInstancesByProject[po.ID]; ok {
			projectDTO.AgentInstances = instances
		}
		if po.IconURI != "" {
			sasURL, err := storage.PathToUrl(po.IconURI)
			if err != nil {
				logger.CtxError(
					ctx,
					"failed to convert project icon uri to CDN: projectId=%d, uri=%s, err=%v",
					po.ID, po.IconURI, err,
				)
			} else {
				projectDTO.IconSasUrl = sasURL
			}
		}
		return projectDTO
	})

	hasNext := int64(req.Page*req.PageSize) < total
	return result, total, hasNext, nil
}

func (s *Service) doAddProjectAsset(
	ctx context.Context,
	req *projectdto.AddProjectAssetRequest,
	creator string,
	file multipart.File,
	fileExtra FileExtraInfo,
) (int64, string, string, *projectdto.FileMetaInfo, error) {
	id, err := s.IDGen.GenID(ctx)
	if err != nil {
		logger.CtxError(ctx, "failed to generate project asset ID: err=%v", err)
		return 0, "", "", nil, err
	}

	objectKey := strconv.FormatInt(id, 10)
	putOpts := make([]storage.PutOptFn, 0, 1)

	if fileExtra.FileExt != "" {
		objectKey = fmt.Sprintf("%s.%s", objectKey, fileExtra.FileExt)
	}

	if len(fileExtra.ContentType) > 0 {
		putOpts = append(putOpts, storage.WithContentType(fileExtra.ContentType))
	}

	// Normalize empty ProjectId to the storage default so that the value we
	// persist matches both the actual storage prefix and the t_project_asset
	// column default. Without this, dedup queries with the original empty
	// value miss the rows that MySQL stored as "default_space".
	if req.ProjectId == "" {
		req.ProjectId = storage.DefaultPathPrefix
	}
	putOpts = append(putOpts, storage.WithPutPathPrefix(req.ProjectId))

	content, err := io.ReadAll(file)
	if err != nil {
		logger.CtxError(
			ctx, "failed to read file content: projectId=%s, err=%v",
			req.ProjectId, err,
		)
		return 0, "", "", nil, err
	}

	path, err := s.BlobClient.PutObject(ctx, objectKey, content, putOpts...)
	if err != nil {
		logger.CtxError(
			ctx,
			"failed to upload project asset: projectId=%s, objectKey=%s, err=%v",
			req.ProjectId, objectKey, err,
		)
		return 0, "", "", nil, err
	}

	sasURL, err := storage.PathToUrl(path)
	if err != nil {
		logger.CtxError(
			ctx,
			"failed to build CDN URL for project asset: projectId=%s, path=%s, err=%v",
			req.ProjectId, path, err,
		)
		return 0, "", "", nil, err
	}

	extraJSON, err := json.Marshal(fileExtra)
	if err != nil {
		logger.CtxError(
			ctx,
			"failed to marshal asset metadata: projectId=%s, err=%v",
			req.ProjectId, err,
		)
		return 0, "", "", nil, apperr.Wrap(errcode.CommonInvalidParam, "invalid file metadata", err)
	}

	asset := &repository.ProjectAssetModel{
		ProjectID:       req.ProjectId,
		ObjectKey:       objectKey,
		CreatorUsername: creator,
		Extra:           string(extraJSON),
	}

	assetID, err := s.ProjectRepo.AddProjectAsset(ctx, asset)
	if err != nil {
		logger.CtxError(
			ctx,
			"failed to save project asset: projectId=%s, objectKey=%s, err=%v",
			req.ProjectId, objectKey, err,
		)
		return 0, "", "", nil, err
	}

	meta := &projectdto.FileMetaInfo{
		FileName:    fileExtra.FileName,
		FileSize:    fileExtra.FileSize,
		FileType:    fileExtra.FileType,
		FileExt:     fileExtra.FileExt,
		ContentType: fileExtra.ContentType,
	}

	return assetID, path, sasURL, meta, nil
}

func (s *Service) doGetUserProjectAssetList(
	ctx context.Context,
	userID string,
	projectID string,
	page, pageSize int32,
) ([]*projectdto.ProjectAsset, int64, error) {
	assets, total, err := s.ProjectRepo.GetUserProjectAssetListWithPagination(ctx, userID, projectID, page, pageSize)
	if err != nil {
		logger.CtxError(
			ctx,
			"failed to get project asset list: userId=%s, projectId=%s, err=%v",
			userID, projectID, err,
		)
		return nil, 0, err
	}

	result := slicesx.Transform(assets, func(po *repository.ProjectAssetModel) *projectdto.ProjectAsset {
		return projectAssetModelToDTO(po)
	})

	return result, total, nil
}

func (s *Service) QueryProjectStatistics(
	ctx context.Context,
	req *projectdto.QueryProjectStatisticsRequest,
) (*projectdto.QueryProjectStatisticsResponse, error) {

	projectId := req.Id

	singleAgentService := singleAgentService.Default()
	filter := &singleAgentEntity.ListSingleAgentInstanceFilter{
		ProjectId: &projectId,
	}
	if req.FilterOperatorUsername != "" {
		filter.OperatorUsername = &req.FilterOperatorUsername
	}
	if req.FilterEmployerUsername != "" {
		filter.EmployerUsername = &req.FilterEmployerUsername
	}

	agentInstances, _, err := singleAgentService.ListSingleAgentInstancesByFilter(
		ctx, filter,
		0, 0,
	)
	if err != nil {
		return nil, err
	}

	agentInstanceIds := make([]int64, 0, len(agentInstances))
	for _, instance := range agentInstances {
		agentInstanceIds = append(agentInstanceIds, instance.Id)
	}
	_ = agentInstanceIds

	// construct statistics
	totalStat := &projectdto.ProjectStatisticsEntry{}
	agentStats := make([]*projectdto.ProjectSingleAgentInstanceStatisticsEntry, 0, len(agentInstances))
	for _, instance := range agentInstances {
		iconSasUrl, err := storage.PathToUrl(instance.IconUri)
		if err != nil {
			logger.CtxWarn(
				ctx,
				"failed to convert icon uri to cdn url: uri=%s, err=%v",
				instance.IconUri, err,
			)
			iconSasUrl = ""
		}
		entry := &projectdto.ProjectSingleAgentInstanceStatisticsEntry{
			AgentInstanceId: instance.Id,
			Name:            instance.Name,
			IconUri:         instance.IconUri,
			IconSasUrl:      iconSasUrl,
			Role:            instance.Role,
			Statistics:      &projectdto.ProjectStatisticsEntry{},
		}
		agentStats = append(agentStats, entry)
	}

	return appresp.Success(&projectdto.QueryProjectStatisticsResponse{
		Data: &projectdto.QueryProjectStatisticsData{
			OverallStatistics:       totalStat,
			AgentInstanceStatistics: agentStats,
		},
	}), nil

}

func (s *Service) syncProjectAdmins(ctx context.Context, projectID int64, admins []string) error {
	existingMap, err := s.ProjectRepo.GetProjectAdminUsernames(ctx, []int64{projectID})
	if err != nil {
		logger.CtxError(
			ctx,
			"failed to load existing project admins: projectId=%d, err=%v",
			projectID, err,
		)
		return err
	}
	existing := existingMap[projectID]

	var toAdd []string
	for _, admin := range admins {
		if !containsString(existing, admin) {
			toAdd = append(toAdd, admin)
		}
	}

	var toRemove []string
	for _, admin := range existing {
		if !containsString(admins, admin) {
			toRemove = append(toRemove, admin)
		}
	}

	if err := s.ProjectRepo.AddProjectAdminsByUsernames(ctx, projectID, toAdd); err != nil {
		logger.CtxError(
			ctx,
			"failed to add project admins: projectId=%d, err=%v",
			projectID, err,
		)
		return err
	}

	if err := s.ProjectRepo.DeleteProjectAdminsByUsernames(ctx, projectID, toRemove); err != nil {
		logger.CtxError(
			ctx,
			"failed to delete removed project admins: projectId=%d, err=%v",
			projectID, err,
		)
		return err
	}

	return nil
}

func containsString(arr []string, target string) bool {
	for _, v := range arr {
		if v == target {
			return true
		}
	}
	return false
}

func (s *Service) fetchProjectAgentInstances(
	ctx context.Context, projectIDs []int64,
) map[int64][]*projectdto.ProjectAgentInstance {
	agentInstances := make(map[int64][]*projectdto.ProjectAgentInstance, len(projectIDs))
	if len(projectIDs) == 0 {
		return agentInstances
	}

	for _, pid := range projectIDs {
		filter := &singleAgentEntity.ListSingleAgentInstanceFilter{
			ProjectId: &pid,
		}

		instances, _, err := singleAgentService.Default().ListSingleAgentInstancesByFilter(ctx, filter, 0, 0)
		if err != nil {
			logger.CtxError(
				ctx,
				"failed to list agent instances for project: projectId=%d, err=%v",
				pid, err,
			)
			continue
		}

		for _, inst := range instances {
			if inst == nil {
				continue
			}

			iconURL := ""
			if inst.IconUri != "" {
				sasURL, err := storage.PathToUrl(inst.IconUri)
				if err != nil {
					logger.CtxError(
						ctx,
						"failed to convert agent icon uri to CDN: projectId=%d, uri=%s, err=%v",
						pid, inst.IconUri, err,
					)
				} else {
					iconURL = sasURL
				}
			}

			agentInstances[pid] = append(agentInstances[pid], &projectdto.ProjectAgentInstance{
				Id:      inst.Id,
				IconUrl: iconURL,
			})
		}
	}

	return agentInstances
}

func projectModelToDTO(po *repository.ProjectModel) *projectdto.Project {
	if po == nil {
		return nil
	}

	return &projectdto.Project{
		Id:              po.ID,
		Name:            po.Name,
		Description:     po.Description,
		OwnerUsername:   po.OwnerUsername,
		CreatorUsername: po.CreatorUsername,
		CreatedAt:       po.CreatedAt,
		UpdatedAt:       po.UpdatedAt,
	}
}

func projectAssetModelToDTO(po *repository.ProjectAssetModel) *projectdto.ProjectAsset {
	if po == nil {
		return nil
	}

	return &projectdto.ProjectAsset{
		Id:              po.ID,
		ProjectId:       po.ProjectID,
		ObjectKey:       po.ObjectKey,
		CreatorUsername: po.CreatorUsername,
		Extra:           po.Extra,
		CreatedAt:       po.CreatedAt,
		UpdatedAt:       po.UpdatedAt,
	}
}
