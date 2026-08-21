package impl

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"

	singleAgentService "sico-backend/internal/biz/agent"
	appresp "sico-backend/internal/biz/common/response"
	notificationService "sico-backend/internal/biz/notification"
	rbac "sico-backend/internal/biz/rbac"
	sandboxbiz "sico-backend/internal/biz/sandbox"
	singleAgentEntity "sico-backend/internal/entity/agent/singleagent"
	notificationEntity "sico-backend/internal/entity/notification"
	"sico-backend/internal/infra/idgen"
	"sico-backend/internal/infra/storage"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/errcode"
	"sico-backend/internal/shared/types"
	agentrepo "sico-backend/internal/store/agent/singleagent/repository"
	"sico-backend/internal/store/project/repository"
	"sico-backend/internal/transport/http/dto/common"
	notificationdto "sico-backend/internal/transport/http/dto/notification"
	projectdto "sico-backend/internal/transport/http/dto/project"
	userdto "sico-backend/internal/transport/http/dto/rbac/user"
	sandboxdto "sico-backend/internal/transport/http/dto/sandbox"
	"sico-backend/pkg/logger"
	"sico-backend/pkg/safego"
	"sico-backend/pkg/slicesx"
)

const projectAssetUploadURLTTL = time.Hour

// Components gathers dependencies required by the project service implementation.
type Components struct {
	ProjectRepo       repository.ProjectRepository
	IDGen             idgen.IDGenerator
	BlobClient        storage.Storage
	AgentInstanceRepo agentrepo.SingleAgentInstanceRepository
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
	// Enforce project.create permission at org scope (or platform scope if no org specified).
	if req.OrganizationId > 0 {
		if err := rbac.CheckCtxAccess(ctx, rbac.ScopeOrg, req.OrganizationId, "project", "create"); err != nil {
			return nil, err
		}
	}

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
	if err := rbac.CheckCtxAccess(ctx, rbac.ScopeProject, req.Id, "project", "manage"); err != nil {
		return nil, err
	}

	if err := s.doUpdateProject(ctx, req); err != nil {
		return nil, err
	}

	return appresp.Success(&projectdto.UpdateProjectResponse{}), nil
}

// DeleteProject removes the project and associated members.
func (s *Service) DeleteProject(
	ctx context.Context, req *projectdto.DeleteProjectRequest,
) (*projectdto.DeleteProjectResponse, error) {
	if err := rbac.CheckCtxAccess(ctx, rbac.ScopeProject, req.Id, "project", "manage"); err != nil {
		return nil, err
	}

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

// ListProjects returns a paginated, filtered list of projects.
func (s *Service) ListProjects(
	ctx context.Context, req *projectdto.ListProjectFilter,
) (*projectdto.ListProjectResponse, error) {
	if s == nil || s.ProjectRepo == nil {
		return nil, apperr.New(errcode.CommonUnavailable, "project service not initialized")
	}

	filter := &repository.ProjectFilter{
		OrganizationID:  req.OrganizationId,
		CreatorUsername: req.CreatorUsername,
		OwnerUsername:   req.OwnerUsername,
	}

	offset := int(req.Page-1) * int(req.PageSize)
	limit := int(req.PageSize)

	projects, total, err := s.ProjectRepo.ListProjects(ctx, filter, offset, limit)
	if err != nil {
		return nil, err
	}

	result := make([]*projectdto.Project, 0, len(projects))
	for _, po := range projects {
		dto := projectModelToDTO(po)
		if po.IconURI != "" {
			if sasURL, err := storage.PathToUrl(po.IconURI); err == nil {
				dto.IconSasUrl = sasURL
			}
		}
		result = append(result, dto)
	}

	hasNext := int64(offset+len(projects)) < total
	return appresp.Success(&projectdto.ListProjectResponse{
		Data: &projectdto.ListProjectData{
			Projects: result,
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

	if admins, err := rbac.ListProjectAdminUsernames(ctx, []int64{projectModel.ID}); err == nil {
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

	// Populate project members and admins (detail-only fields)
	projectDTO.ProjectMembers = s.fetchProjectUserDigests(ctx, projectModel.ID, false)
	projectDTO.ProjectAdmins = s.fetchProjectUserDigests(ctx, projectModel.ID, true)

	// Populate sandboxes assigned to this project's instances
	projectDTO.Sandboxes = s.fetchProjectSandboxes(ctx, projectModel.ID, projectModel.OrganizationID)

	return appresp.Success(&projectdto.GetProjectDetailResponse{Data: projectDTO}), nil
}

// AddProjectAsset uploads a project asset and persists its metadata.
func (s *Service) AddProjectAsset(
	ctx context.Context,
	req *projectdto.AddProjectAssetRequest,
	creator string,
	file io.Reader,
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

// CreateProjectAssetUploadURL returns a write URL for direct upload without creating a visible asset record.
func (s *Service) CreateProjectAssetUploadURL(
	ctx context.Context,
	req *projectdto.CreateProjectAssetUploadURLRequest,
	fileExtra FileExtraInfo,
) (*projectdto.CreateProjectAssetUploadURLResponse, error) {
	objectKey, uploadURL, meta, err := s.doCreateProjectAssetUploadURL(ctx, req, fileExtra)
	if err != nil {
		return nil, err
	}
	expiresAt := uploadURL.ExpiresAt.Unix()
	if uploadURL.ExpiresAt.IsZero() {
		expiresAt = time.Now().Add(projectAssetUploadURLTTL).Unix()
	}

	return appresp.Success(&projectdto.CreateProjectAssetUploadURLResponse{
		Data: &projectdto.CreateProjectAssetUploadURLData{
			UploadUrl: uploadURL.URL,
			Uri:       uploadURL.Path,
			ObjectKey: objectKey,
			Method:    uploadURL.Method,
			Headers:   uploadURL.Headers,
			ExpiresAt: expiresAt,
			MetaInfo:  meta,
		},
	}), nil
}

// CompleteProjectAssetUpload verifies a direct upload and persists its metadata.
func (s *Service) CompleteProjectAssetUpload(
	ctx context.Context,
	req *projectdto.CompleteProjectAssetUploadRequest,
	creator string,
	fileExtra FileExtraInfo,
) (*projectdto.CompleteProjectAssetUploadResponse, error) {
	id, url, sasURL, meta, err := s.doCompleteProjectAssetUpload(ctx, req, creator, fileExtra)
	if err != nil {
		return nil, err
	}

	return appresp.Success(&projectdto.CompleteProjectAssetUploadResponse{
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
		OrganizationID:  req.OrganizationId,
	}

	if err := s.ProjectRepo.CreateProject(ctx, projectModel); err != nil {
		logger.CtxError(ctx, "failed to create project: name=%s, creator=%s, err=%v", req.Name, creator, err)
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return 0, apperr.New(errcode.CommonConflict, "project already exists")
		}
		return 0, err
	}

	// Project admins are also project members.
	if err := rbac.AssignProjectRole(ctx, creator, rbac.RoleProjectMember, projectModel.ID); err != nil {
		logger.CtxError(ctx, "failed to assign project member role to creator: projectId=%d, creator=%s, err=%v",
			projectModel.ID, creator, err)
		if delErr := s.ProjectRepo.DeleteProject(ctx, projectModel.ID); delErr != nil {
			logger.CtxError(ctx, "failed to roll back project after RBAC failure: projectId=%d, err=%v",
				projectModel.ID, delErr)
		}
		return 0, err
	}

	if err := rbac.AssignProjectRole(ctx, creator, rbac.RoleProjectAdmin, projectModel.ID); err != nil {
		logger.CtxError(ctx, "failed to assign project admin role to creator: projectId=%d, creator=%s, err=%v",
			projectModel.ID, creator, err)
		if removeErr := rbac.RemoveAllProjectRoles(ctx, projectModel.ID); removeErr != nil {
			logger.CtxError(
				ctx, "failed to roll back project roles: projectId=%d, err=%v", projectModel.ID, removeErr,
			)
		}
		if delErr := s.ProjectRepo.DeleteProject(ctx, projectModel.ID); delErr != nil {
			logger.CtxError(ctx, "failed to roll back project after RBAC failure: projectId=%d, err=%v",
				projectModel.ID, delErr)
		}
		return 0, err
	}

	// Assign additional operator admins.
	for _, admin := range req.OperatorAdmins {
		if admin == "" || admin == creator {
			continue
		}
		if err := rbac.AssignProjectRole(ctx, admin, rbac.RoleProjectAdmin, projectModel.ID); err != nil {
			logger.CtxError(ctx, "failed to assign project admin: projectId=%d, admin=%s, err=%v",
				projectModel.ID, admin, err)
			// Non-fatal: creator is already assigned, additional admins can be retried.
		}
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
	if err := rbac.RemoveAllProjectRoles(ctx, projectID); err != nil {
		logger.CtxError(ctx, "failed to remove project roles: projectId=%d, err=%v", projectID, err)
		return err
	}

	return nil
}

func (s *Service) doGetUserProjectList(
	ctx context.Context,
	req *projectdto.GetUserProjectListRequest,
) ([]*projectdto.Project, int64, bool, error) {
	// Map MemberType filter to RBAC role code.
	roleCodeFilter := memberTypeToRoleFilter(req.MemberType)

	memberships, _, err := rbac.GetUserProjectListByUsername(ctx, req.Username, roleCodeFilter)
	if err != nil {
		logger.CtxError(ctx, "failed to get user project list: username=%s, err=%v", req.Username, err)
		return nil, 0, false, err
	}

	if len(memberships) == 0 {
		return []*projectdto.Project{}, 0, false, nil
	}

	// De-duplicate and collect project IDs with role mapping.
	roleByProject := make(map[int64]string, len(memberships))
	projectIDs := make([]int64, 0, len(memberships))
	for _, m := range memberships {
		currentRole, exists := roleByProject[m.ProjectID]
		if !exists {
			projectIDs = append(projectIDs, m.ProjectID)
		}
		if !exists || projectRolePriority(m.RoleCode) > projectRolePriority(currentRole) {
			roleByProject[m.ProjectID] = m.RoleCode
		}
	}

	// Apply pagination on the project IDs.
	total := int64(len(projectIDs))
	pagedIDs := paginateIDs(projectIDs, req.Page, req.PageSize)

	if len(pagedIDs) == 0 {
		return []*projectdto.Project{}, total, false, nil
	}

	projects, err := s.ProjectRepo.GetProjectByIDs(ctx, pagedIDs)
	if err != nil {
		logger.CtxError(ctx, "failed to get projects by IDs: ids=%v, err=%v", pagedIDs, err)
		return nil, 0, false, err
	}

	adminByProject, err := rbac.ListProjectAdminUsernames(ctx, pagedIDs)
	if err != nil {
		logger.CtxError(ctx, "failed to get project admins: ids=%v, err=%v", pagedIDs, err)
		return nil, 0, false, err
	}

	agentInstancesByProject := s.fetchProjectAgentInstances(ctx, pagedIDs)

	result := slicesx.Transform(projects, func(po *repository.ProjectModel) *projectdto.Project {
		return s.enrichProjectDTO(ctx, po, req.Username, roleByProject, adminByProject, agentInstancesByProject)
	})

	hasNext := int64(req.Page*req.PageSize) < total
	return result, total, hasNext, nil
}

func paginateIDs(ids []int64, page, pageSize int32) []int64 {
	start := int((page - 1) * pageSize)
	end := start + int(pageSize)
	if start > len(ids) {
		start = len(ids)
	}
	if end > len(ids) {
		end = len(ids)
	}
	return ids[start:end]
}

func (s *Service) enrichProjectDTO(
	ctx context.Context,
	po *repository.ProjectModel,
	username string,
	roleByProject map[int64]string,
	adminByProject map[int64][]string,
	agentInstancesByProject map[int64][]*common.AgentInstanceDigest,
) *projectdto.Project {
	projectDTO := projectModelToDTO(po)
	if rc, ok := roleByProject[po.ID]; ok {
		projectDTO.MemberType = roleCodeToMemberType(rc)
	}
	if po.CreatorUsername == username {
		projectDTO.MemberType = projectdto.MemberType_MEMBER_TYPE_OWNER
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
			logger.CtxError(ctx, "failed to convert project icon uri to CDN: projectId=%d, uri=%s, err=%v",
				po.ID, po.IconURI, err)
		} else {
			projectDTO.IconSasUrl = sasURL
		}
	}
	return projectDTO
}

func memberTypeToRoleFilter(mt projectdto.MemberType) string {
	switch mt {
	case projectdto.MemberType_MEMBER_TYPE_ADMIN:
		return rbac.RoleProjectAdmin
	case projectdto.MemberType_MEMBER_TYPE_MEMBER:
		return rbac.RoleProjectMember
	default:
		return "" // all roles
	}
}

func roleCodeToMemberType(roleCode string) projectdto.MemberType {
	switch roleCode {
	case rbac.RoleProjectAdmin:
		return projectdto.MemberType_MEMBER_TYPE_ADMIN
	case rbac.RoleProjectMember:
		return projectdto.MemberType_MEMBER_TYPE_MEMBER
	default:
		return projectdto.MemberType_MEMBER_TYPE_UNKNOWN
	}
}

func projectRolePriority(roleCode string) int {
	switch roleCode {
	case rbac.RoleProjectAdmin:
		return 2
	case rbac.RoleProjectMember:
		return 1
	default:
		return 0
	}
}

func (s *Service) doAddProjectAsset(
	ctx context.Context,
	req *projectdto.AddProjectAssetRequest,
	creator string,
	file io.Reader,
	fileExtra FileExtraInfo,
) (int64, string, string, *projectdto.FileMetaInfo, error) {
	if file == nil {
		return 0, "", "", nil, apperr.New(errcode.CommonInvalidParam, "file is required")
	}
	projectID := normalizeProjectID(req.GetProjectId())

	objectKey, putOpts, err := s.prepareProjectAssetStorage(ctx, projectID, fileExtra)
	if err != nil {
		return 0, "", "", nil, err
	}

	uploaded, err := s.BlobClient.UploadObject(ctx, objectKey, file, putOpts...)
	if err != nil {
		logger.CtxError(
			ctx,
			"failed to upload project asset: projectId=%s, objectKey=%s, err=%v",
			projectID, objectKey, err,
		)
		return 0, "", "", nil, err
	}
	if uploaded == nil || uploaded.Path == "" {
		return 0, "", "", nil, apperr.New(errcode.CommonUnavailable, "project asset upload returned empty path")
	}
	path := uploaded.Path

	sasURL, err := storage.PathToUrl(path)
	if err != nil {
		logger.CtxError(
			ctx,
			"failed to build CDN URL for project asset: projectId=%s, path=%s, err=%v",
			projectID, path, err,
		)
		return 0, "", "", nil, err
	}

	assetID, meta, err := s.saveProjectAsset(ctx, projectID, creator, objectKey, fileExtra)
	if err != nil {
		return 0, "", "", nil, err
	}

	return assetID, path, sasURL, meta, nil
}

func (s *Service) doCreateProjectAssetUploadURL(
	ctx context.Context,
	req *projectdto.CreateProjectAssetUploadURLRequest,
	fileExtra FileExtraInfo,
) (string, *storage.UploadURL, *projectdto.FileMetaInfo, error) {
	projectID := normalizeProjectID(req.GetProjectId())
	objectKey, putOpts, err := s.prepareProjectAssetStorage(ctx, projectID, fileExtra)
	if err != nil {
		return "", nil, nil, err
	}
	putOpts = append(putOpts, storage.WithExpires(time.Now().Add(projectAssetUploadURLTTL)))
	uploadURL, err := s.BlobClient.CreateUploadURL(ctx, objectKey, putOpts...)
	if err != nil {
		logger.CtxError(
			ctx,
			"failed to create project asset upload URL: projectId=%s, objectKey=%s, err=%v",
			projectID,
			objectKey,
			err,
		)
		return "", nil, nil, err
	}
	if uploadURL == nil || uploadURL.Path == "" || uploadURL.URL == "" {
		return "", nil, nil, apperr.New(errcode.CommonUnavailable, "project asset upload URL is incomplete")
	}
	return objectKey, uploadURL, fileMetaInfoFromExtra(fileExtra), nil
}

func (s *Service) doCompleteProjectAssetUpload(
	ctx context.Context,
	req *projectdto.CompleteProjectAssetUploadRequest,
	creator string,
	fileExtra FileExtraInfo,
) (int64, string, string, *projectdto.FileMetaInfo, error) {
	projectID := normalizeProjectID(req.GetProjectId())
	objectKey := strings.TrimSpace(req.GetObjectKey())
	if objectKey == "" || strings.Contains(objectKey, "/") {
		return 0, "", "", nil, apperr.New(errcode.CommonInvalidParam, "invalid object key")
	}
	if _, err := s.ProjectRepo.GetProjectAssetByObjectKey(ctx, projectID, objectKey); err == nil {
		return 0, "", "", nil, apperr.New(errcode.CommonConflict, "project asset upload already completed")
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, "", "", nil, err
	}

	objectInfo, err := s.verifyUploadedAsset(ctx, projectID, objectKey, &fileExtra)
	if err != nil {
		return 0, "", "", nil, err
	}
	sasURL, err := storage.PathToUrl(objectInfo.Path)
	if err != nil {
		logger.CtxError(
			ctx,
			"failed to build CDN URL for completed project asset: projectId=%s, path=%s, err=%v",
			projectID,
			objectInfo.Path,
			err,
		)
		return 0, "", "", nil, err
	}
	assetID, meta, err := s.saveProjectAsset(ctx, projectID, creator, objectKey, fileExtra)
	if err != nil {
		return 0, "", "", nil, err
	}
	return assetID, objectInfo.Path, sasURL, meta, nil
}

func (s *Service) verifyUploadedAsset(
	ctx context.Context,
	projectID, objectKey string,
	fileExtra *FileExtraInfo,
) (*storage.ObjectInfo, error) {
	objectInfo, err := s.BlobClient.GetObjectInfo(ctx, objectKey, storage.WithGetPathPrefix(projectID))
	if err != nil {
		if errors.Is(err, storage.ErrObjectNotFound) {
			return nil, apperr.New(errcode.CommonNotFound, "uploaded project asset not found")
		}
		logger.CtxError(
			ctx,
			"failed to verify project asset upload: projectId=%s, objectKey=%s, err=%v",
			projectID,
			objectKey,
			err,
		)
		return nil, err
	}
	if objectInfo == nil || objectInfo.Path == "" {
		return nil, apperr.New(errcode.CommonUnavailable, "project asset verification returned empty path")
	}
	if fileExtra.FileSize > 0 && objectInfo.Size > 0 && fileExtra.FileSize != objectInfo.Size {
		return nil, apperr.New(errcode.CommonInvalidParam, "uploaded project asset size does not match metadata")
	}
	if fileExtra.FileSize == 0 {
		fileExtra.FileSize = objectInfo.Size
	}
	if fileExtra.ContentType == "" {
		fileExtra.ContentType = objectInfo.ContentType
	}
	return objectInfo, nil
}

func (s *Service) prepareProjectAssetStorage(
	ctx context.Context,
	projectID string,
	fileExtra FileExtraInfo,
) (string, []storage.PutOptFn, error) {
	if s == nil || s.Components == nil || s.ProjectRepo == nil || s.IDGen == nil || s.BlobClient == nil {
		return "", nil, apperr.New(errcode.CommonUnavailable, "project service not initialized")
	}
	projectID = normalizeProjectID(projectID)
	id, err := s.IDGen.GenID(ctx)
	if err != nil {
		logger.CtxError(ctx, "failed to generate project asset ID: err=%v", err)
		return "", nil, err
	}
	objectKey := strconv.FormatInt(id, 10)
	putOpts := make([]storage.PutOptFn, 0, 2)
	if fileExtra.FileExt != "" {
		objectKey = fmt.Sprintf("%s.%s", objectKey, fileExtra.FileExt)
	}
	if fileExtra.ContentType != "" {
		putOpts = append(putOpts, storage.WithContentType(fileExtra.ContentType))
	}
	putOpts = append(putOpts, storage.WithPutPathPrefix(projectID))
	return objectKey, putOpts, nil
}

func normalizeProjectID(projectID string) string {
	if projectID == "" {
		return storage.DefaultPathPrefix
	}
	return projectID
}

func fileMetaInfoFromExtra(fileExtra FileExtraInfo) *projectdto.FileMetaInfo {
	return &projectdto.FileMetaInfo{
		FileName: fileExtra.FileName, FileSize: fileExtra.FileSize, FileType: fileExtra.FileType,
		FileExt: fileExtra.FileExt, ContentType: fileExtra.ContentType,
	}
}

func (s *Service) saveProjectAsset(
	ctx context.Context,
	projectID, creator, objectKey string,
	fileExtra FileExtraInfo,
) (int64, *projectdto.FileMetaInfo, error) {
	extraJSON, err := json.Marshal(fileExtra)
	if err != nil {
		logger.CtxError(ctx, "failed to marshal asset metadata: projectId=%s, err=%v", projectID, err)
		return 0, nil, apperr.Wrap(errcode.CommonInvalidParam, "invalid file metadata", err)
	}
	asset := &repository.ProjectAssetModel{
		ProjectID:       projectID,
		ObjectKey:       objectKey,
		CreatorUsername: creator,
		Extra:           string(extraJSON),
	}

	assetID, err := s.ProjectRepo.AddProjectAsset(ctx, asset)
	if err != nil {
		logger.CtxError(
			ctx,
			"failed to save project asset: projectId=%s, objectKey=%s, err=%v",
			projectID,
			objectKey,
			err,
		)
		return 0, nil, err
	}
	return assetID, fileMetaInfoFromExtra(fileExtra), nil
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
	existingMap, err := rbac.ListProjectAdminUsernames(ctx, []int64{projectID})
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

	for _, admin := range toAdd {
		if err := rbac.AssignProjectRole(ctx, admin, rbac.RoleProjectAdmin, projectID); err != nil {
			logger.CtxError(ctx, "failed to add project admin: projectId=%d, admin=%s, err=%v",
				projectID, admin, err)
		}
	}

	for _, admin := range toRemove {
		if err := rbac.RemoveProjectRole(ctx, admin, rbac.RoleProjectAdmin, projectID); err != nil {
			logger.CtxError(ctx, "failed to remove project admin: projectId=%d, admin=%s, err=%v",
				projectID, admin, err)
		}
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
) map[int64][]*common.AgentInstanceDigest {
	agentInstances := make(map[int64][]*common.AgentInstanceDigest, len(projectIDs))
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

			agentInstances[pid] = append(agentInstances[pid], &common.AgentInstanceDigest{
				Id:               inst.Id,
				AgentName:        inst.Name,
				AgentIconUrl:     inst.IconUri,
				OperatorUsername: inst.OperatorUsername,
			})
		}
	}

	return agentInstances
}

// fetchProjectUserDigests returns UserDigest list for a project.
// If adminsOnly is true, returns only admins; otherwise returns all members (admins + members).
func (s *Service) fetchProjectUserDigests(
	ctx context.Context, projectID int64, adminsOnly bool,
) []*common.UserDigest {
	var usernames []string
	var err error

	if adminsOnly {
		adminMap, e := rbac.ListProjectAdminUsernames(ctx, []int64{projectID})
		if e != nil {
			logger.CtxError(ctx, "fetchProjectUserDigests: failed to list admin usernames: %v", e)
			return nil
		}
		usernames = adminMap[projectID]
	} else {
		usernames, err = rbac.ListProjectMemberUsernames(ctx, projectID)
		if err != nil {
			logger.CtxError(ctx, "fetchProjectUserDigests: failed to list member usernames: %v", err)
			return nil
		}
	}

	if len(usernames) == 0 {
		return nil
	}

	rbacSvc := rbac.Default()
	if rbacSvc == nil {
		return nil
	}

	digests := make([]*common.UserDigest, 0, len(usernames))
	for _, username := range usernames {
		resp, err := rbacSvc.GetUser(ctx, &userdto.GetUserRequest{Username: username})
		if err != nil || resp == nil || resp.Data == nil || resp.Data.User == nil {
			continue
		}
		u := resp.Data.User
		iconURL := ""
		if u.RawIconUri != "" {
			if url, err := storage.PathToUrl(u.RawIconUri); err == nil {
				iconURL = url
			}
		}
		digests = append(digests, &common.UserDigest{
			Id:       u.Id,
			Alias:    u.Alias,
			Username: u.Username,
			Email:    u.Email,
			IconUrl:  iconURL,
		})
	}

	return digests
}

// fetchProjectSandboxes returns SandboxDigest list for all active instances in a project.
func (s *Service) fetchProjectSandboxes(ctx context.Context, projectID, organizationID int64) []*common.SandboxDigest {
	sandboxSvc := sandboxbiz.Default()
	if sandboxSvc == nil {
		return nil
	}

	resources, err := sandboxSvc.ListAllResourcesFiltered(ctx, &sandboxdto.ListSandboxResourcesFilter{
		ProjectId: &projectID,
	})
	if err != nil {
		logger.CtxError(ctx, "fetchProjectSandboxes: failed to list resources: %v", err)
		return nil
	}

	var result []*common.SandboxDigest
	for _, typeResources := range resources {
		items, ok := typeResources.([]map[string]interface{})
		if !ok {
			continue
		}
		for _, sb := range items {
			var instanceID int64
			if v, ok := sb["instance_id"]; ok {
				switch id := v.(type) {
				case int64:
					instanceID = id
				case string:
					instanceID, _ = strconv.ParseInt(id, 10, 64)
				}
			}
			digest := &common.SandboxDigest{
				SandboxId:      getStringFromMap(sb, "sandbox_id"),
				Type:           getStringFromMap(sb, "type"),
				Status:         getStringFromMap(sb, "status"),
				Endpoint:       getStringFromMap(sb, "endpoint"),
				VncUrl:         getStringFromMap(sb, "vnc_url"),
				DocsUrl:        getStringFromMap(sb, "docs_url"),
				DisplayName:    getStringFromMap(sb, "display_name"),
				InstanceId:     instanceID,
				ProjectId:      projectID,
				OrganizationId: organizationID,
			}
			result = append(result, digest)
		}
	}

	return result
}

func getStringFromMap(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
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

// CreateProjectDeliverable publishes a file deliverable to a project.
func (s *Service) CreateProjectDeliverable(
	ctx context.Context,
	req *projectdto.CreateProjectDeliverableRequest,
	creator string,
) (*projectdto.CreateProjectDeliverableResponse, error) {
	record := &repository.ProjectDeliverableModel{
		ProjectID:       req.ProjectId,
		FileName:        req.FileName,
		FileURI:         req.FileUri,
		CreatorUsername: creator,
		AgentInstanceID: req.AgentInstanceId,
	}

	id, err := s.ProjectRepo.CreateProjectDeliverable(ctx, record)
	if err != nil {
		return nil, err
	}

	notifyCtx := context.WithoutCancel(ctx)
	safego.Go(notifyCtx, func() {
		s.notifyDeliverablePublished(notifyCtx, id, req, creator)
	})

	return appresp.Success(&projectdto.CreateProjectDeliverableResponse{
		Data: &projectdto.CreateProjectDeliverableData{Id: id},
	}), nil
}

func (s *Service) notifyDeliverablePublished(
	ctx context.Context,
	deliverableID int64,
	req *projectdto.CreateProjectDeliverableRequest,
	creator string,
) {
	project, err := s.ProjectRepo.GetProjectByID(ctx, req.ProjectId)
	if err != nil {
		logger.CtxError(ctx, "notifyDeliverablePublished: failed to get project %d: %v", req.ProjectId, err)
		return
	}

	var agentInstanceName string
	var agentInstanceIconUri string
	agentSvc := singleAgentService.Default()
	if agentSvc != nil && req.AgentInstanceId > 0 {
		names, nameErr := agentSvc.GetSingleAgentInstanceNames(ctx, []int64{req.AgentInstanceId})
		if nameErr != nil {
			logger.CtxError(ctx, "notifyDeliverablePublished: failed to get agent instance name: %v", nameErr)
		} else {
			agentInstanceName = names[req.AgentInstanceId]
		}
		icons, iconErr := agentSvc.GetSingleAgentInstanceIconURIs(ctx, []int64{req.AgentInstanceId})
		if iconErr != nil {
			logger.CtxError(ctx, "notifyDeliverablePublished: failed to get agent instance icon URI: %v", iconErr)
		} else {
			agentInstanceIconUri = icons[req.AgentInstanceId]
		}
	}

	extraInfo := &notificationdto.NotificationExtraInfo{
		Deliverable: &notificationdto.NotificationExtraInfoDeliverable{
			DeliverableId:        deliverableID,
			FileName:             req.FileName,
			FileUri:              req.FileUri,
			AgentInstanceId:      req.AgentInstanceId,
			AgentInstanceName:    agentInstanceName,
			AgentInstanceIconUri: agentInstanceIconUri,
			ProjectName:          project.Name,
		},
	}

	notifSvc := notificationService.Default()
	if notifSvc == nil {
		logger.CtxError(ctx, "notifyDeliverablePublished: notification service not initialized")
		return
	}

	members, err := rbac.ListProjectMemberUsernames(ctx, req.ProjectId)
	if err != nil {
		logger.CtxError(ctx, "notifyDeliverablePublished: failed to list project members: %v", err)
		return
	}

	for _, username := range members {
		if username == creator {
			continue
		}
		_, err := notifSvc.Create(ctx, &notificationEntity.Notification{
			Type:             notificationdto.NotificationType_NOTIFICATION_TYPE_DELIVERABLE_PUBLISHED,
			SenderUsername:   creator,
			ReceiverUsername: username,
			ExtraInfo:        extraInfo,
			ProjectId:        req.ProjectId,
		})
		if err != nil {
			logger.CtxError(ctx, "notifyDeliverablePublished: failed to notify user %s: %v", username, err)
		}
	}

	_, err = notifSvc.Create(ctx, &notificationEntity.Notification{
		Type:           notificationdto.NotificationType_NOTIFICATION_TYPE_DELIVERABLE_PUBLISHED,
		SenderUsername: creator,
		ExtraInfo:      extraInfo,
		ProjectId:      req.ProjectId,
	})
	if err != nil {
		logger.CtxError(ctx, "notifyDeliverablePublished: failed to create project notification: %v", err)
	}
}

// ListProjectDeliverables retrieves paginated deliverables for a project.
func (s *Service) ListProjectDeliverables(
	ctx context.Context,
	req *projectdto.ListProjectDeliverablesRequest,
) (*projectdto.ListProjectDeliverablesResponse, error) {
	page := req.GetPage()
	if page <= 0 {
		page = 1
	}
	pageSize := req.GetPageSize()
	if pageSize <= 0 {
		pageSize = 10
	}

	offset := int((page - 1) * pageSize)
	limit := int(pageSize)

	records, total, err := s.ProjectRepo.ListProjectDeliverables(ctx, req.ProjectId, offset, limit)
	if err != nil {
		return nil, err
	}

	deliverables := make([]*projectdto.ProjectDeliverable, 0, len(records))
	for _, r := range records {
		fileSasUrl, _ := storage.PathToUrl(r.FileURI)
		deliverables = append(deliverables, &projectdto.ProjectDeliverable{
			Id:              r.ID,
			ProjectId:       r.ProjectID,
			FileName:        r.FileName,
			FileUri:         r.FileURI,
			FileSasUrl:      fileSasUrl,
			CreatorUsername: r.CreatorUsername,
			AgentInstanceId: r.AgentInstanceID,
			CreatedAt:       r.CreatedAt,
			UpdatedAt:       r.UpdatedAt,
		})
	}

	s.populateDeliverableExtraInfo(ctx, deliverables)

	hasMore := int64(page*pageSize) < total

	return appresp.Success(&projectdto.ListProjectDeliverablesResponse{
		Data: &projectdto.ListProjectDeliverablesData{
			Deliverables: deliverables,
			Total:        int32(total),
			HasMore:      hasMore,
		},
	}), nil
}

// GetProjectDeliverable retrieves a single project deliverable by ID.
func (s *Service) GetProjectDeliverable(
	ctx context.Context,
	req *projectdto.GetProjectDeliverableRequest,
) (*projectdto.GetProjectDeliverableResponse, error) {
	record, err := s.ProjectRepo.GetProjectDeliverable(ctx, req.Id)
	if err != nil {
		return nil, apperr.New(errcode.CommonNotFound, "deliverable not found")
	}

	fileSasUrl, _ := storage.PathToUrl(record.FileURI)
	d := &projectdto.ProjectDeliverable{
		Id:              record.ID,
		ProjectId:       record.ProjectID,
		FileName:        record.FileName,
		FileUri:         record.FileURI,
		FileSasUrl:      fileSasUrl,
		CreatorUsername: record.CreatorUsername,
		AgentInstanceId: record.AgentInstanceID,
		CreatedAt:       record.CreatedAt,
		UpdatedAt:       record.UpdatedAt,
	}

	s.populateDeliverableExtraInfo(ctx, []*projectdto.ProjectDeliverable{d})

	return appresp.Success(&projectdto.GetProjectDeliverableResponse{
		Data: &projectdto.GetProjectDeliverableData{Deliverable: d},
	}), nil
}

func (s *Service) DeleteProjectDeliverable(
	ctx context.Context,
	req *projectdto.DeleteProjectDeliverableRequest,
) (*projectdto.DeleteProjectDeliverableResponse, error) {
	if _, err := s.ProjectRepo.GetProjectDeliverable(ctx, req.Id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperr.New(errcode.CommonNotFound, "deliverable not found")
		}
		return nil, err
	}

	if err := s.ProjectRepo.DeleteProjectDeliverable(ctx, req.Id); err != nil {
		return nil, err
	}

	return appresp.Success(&projectdto.DeleteProjectDeliverableResponse{}), nil
}

// populateDeliverableExtraInfo fills ExtraInfo (agent name and icon) for a slice of deliverable DTOs.
func (s *Service) populateDeliverableExtraInfo(ctx context.Context, deliverables []*projectdto.ProjectDeliverable) {
	if s.AgentInstanceRepo == nil || len(deliverables) == 0 {
		return
	}

	ids := make([]int64, 0, len(deliverables))
	seen := make(map[int64]bool)
	for _, d := range deliverables {
		if d.AgentInstanceId != 0 && !seen[d.AgentInstanceId] {
			ids = append(ids, d.AgentInstanceId)
			seen[d.AgentInstanceId] = true
		}
	}
	if len(ids) == 0 {
		return
	}

	instances, err := s.AgentInstanceRepo.MGet(ctx, ids)
	if err != nil {
		logger.CtxWarn(ctx, "populateDeliverableExtraInfo: failed to fetch agent instances: %v", err)
		return
	}

	instanceMap := make(map[int64]*common.AgentInstanceDigest, len(instances))
	for _, inst := range instances {
		iconURL, _ := storage.PathToUrl(inst.IconUri)
		instanceMap[inst.Id] = &common.AgentInstanceDigest{
			Id:               inst.Id,
			AgentName:        inst.Name,
			AgentIconUrl:     iconURL,
			OperatorUsername: inst.OperatorUsername,
		}
	}

	for _, d := range deliverables {
		if info, ok := instanceMap[d.AgentInstanceId]; ok {
			d.ExtraInfo = &projectdto.ProjectDeliverableExtraInfo{
				AgentInstance: info,
			}
		}
	}
}
