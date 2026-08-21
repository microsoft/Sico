package impl

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	appresp "sico-backend/internal/biz/common/response"
	knowledgebiz "sico-backend/internal/biz/knowledge"
	notificationbiz "sico-backend/internal/biz/notification"
	rbac "sico-backend/internal/biz/rbac"
	sandboxbiz "sico-backend/internal/biz/sandbox"
	entity "sico-backend/internal/entity/agent/singleagent"
	notificationEntity "sico-backend/internal/entity/notification"
	"sico-backend/internal/infra/storage"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/enum"
	"sico-backend/internal/shared/errcode"
	"sico-backend/internal/store/agent/singleagent/repository"
	"sico-backend/internal/transport/http/dto/agent/single_agent"
	"sico-backend/internal/transport/http/dto/knowledge"
	notificationdto "sico-backend/internal/transport/http/dto/notification"
	"sico-backend/internal/transport/http/middleware"
	"sico-backend/pkg/logger"
	"sico-backend/pkg/safego"

	"gorm.io/gorm"
)

func (s *Service) CreateSingleAgent(
	ctx context.Context, req *single_agent.CreateSingleAgentRequest,
) (*single_agent.CreateSingleAgentResponse, error) {
	agentEntity := &entity.SingleAgent{
		SingleAgent: &single_agent.SingleAgent{
			AgentId:         req.AgentId,
			CreatorUsername: req.CreatorUsername,
			Name:            req.Name,
			Desc:            req.Desc,
			IconUri:         req.IconUri,
			Role:            req.Role,
			UpdaterUsername: req.UpdaterUsername,
			OrganizationId:  req.OrganizationId,
		},
	}

	var agentID string
	err := s.withRepositories(ctx, func(
		agentRepo repository.SingleAgentRepository,
		_ repository.SingleAgentInstanceRepository,
	) error {
		if err := agentRepo.Create(ctx, req.CreatorUsername, agentEntity); err != nil {
			return err
		}
		agentID = agentEntity.AgentId
		return nil
	})
	if err != nil {
		return nil, err
	}

	return appresp.Success(&single_agent.CreateSingleAgentResponse{
		Data: &single_agent.CreateSingleAgentData{AgentId: agentID},
	}), nil
}

func (s *Service) GetSingleAgent(
	ctx context.Context, req *single_agent.GetSingleAgentRequest,
) (*single_agent.GetSingleAgentResponse, error) {
	agent, err := s.getSingleAgent(ctx, req.AgentId)
	if err != nil {
		return nil, err
	}
	if agent == nil {
		return nil, apperr.New(errcode.CommonNotFound, "agent not found")
	}

	cdnIconUri, err := storage.PathToUrl(agent.IconUri)
	if err != nil {
		logger.CtxWarn(ctx, "failed to convert icon to CDN, err:%v", err)
	}
	agent.IconUri = cdnIconUri

	return appresp.Success(&single_agent.GetSingleAgentResponse{
		Data: &single_agent.GetSingleAgentData{Agent: agent.SingleAgent},
	}), nil
}

func (s *Service) UpdateSingleAgent(
	ctx context.Context, req *single_agent.UpdateSingleAgentRequest,
) (*single_agent.UpdateSingleAgentResponse, error) {
	existing, err := s.getSingleAgent(ctx, req.AgentId)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, apperr.New(errcode.CommonNotFound, "agent not found")
	}

	if err := rbac.CheckCtxAccessScopedOrIsOwner(
		ctx, rbac.ScopeAgent, req.AgentId, "agent", "manage", existing.CreatorUsername,
	); err != nil {
		return nil, err
	}

	agentEntity := &entity.SingleAgent{
		SingleAgent: &single_agent.SingleAgent{
			AgentId:         req.AgentId,
			Name:            req.Name,
			Desc:            req.Desc,
			IconUri:         req.IconUri,
			Role:            req.Role,
			UpdaterUsername: req.UpdaterUsername,
		},
	}

	if err := s.withRepositories(ctx, func(
		agentRepo repository.SingleAgentRepository,
		_ repository.SingleAgentInstanceRepository,
	) error {
		return agentRepo.Update(ctx, agentEntity)
	}); err != nil {
		return nil, err
	}

	return appresp.Success(&single_agent.UpdateSingleAgentResponse{}), nil
}

func (s *Service) DeleteSingleAgent(
	ctx context.Context, req *single_agent.DeleteSingleAgentRequest,
) (*single_agent.DeleteSingleAgentResponse, error) {
	if err := s.withRepositories(ctx, func(
		agentRepo repository.SingleAgentRepository,
		instanceRepo repository.SingleAgentInstanceRepository,
	) error {
		agent, err := agentRepo.GetForUpdate(ctx, req.AgentId)
		if err != nil {
			return err
		}
		if agent == nil {
			return apperr.New(errcode.CommonNotFound, "agent not found")
		}

		agent.PublishStatus = single_agent.SingleAgentPublishStatus_SINGLE_AGENT_PUBLISH_STATUS_ARCHIVED
		return agentRepo.Update(ctx, agent)
	}); err != nil {
		return nil, err
	}

	return appresp.Success(&single_agent.DeleteSingleAgentResponse{}), nil
}

func (s *Service) PublishSingleAgent(
	ctx context.Context, req *single_agent.PublishSingleAgentRequest,
) (*single_agent.PublishSingleAgentResponse, error) {
	if err := s.withRepositories(ctx, func(
		agentRepo repository.SingleAgentRepository,
		_ repository.SingleAgentInstanceRepository,
	) error {
		agent, err := agentRepo.GetForUpdate(ctx, req.AgentId)
		if err != nil {
			return err
		}
		if agent == nil {
			return apperr.New(errcode.CommonNotFound, "agent not found")
		}

		if agent.PublishStatus != single_agent.SingleAgentPublishStatus_SINGLE_AGENT_PUBLISH_STATUS_DRAFT {
			return apperr.New(errcode.CommonInvalidParam, "agent is not in draft status")
		}

		agent.PublishStatus = single_agent.SingleAgentPublishStatus_SINGLE_AGENT_PUBLISH_STATUS_PUBLISHED
		return agentRepo.Update(ctx, agent)
	}); err != nil {
		return nil, err
	}

	return appresp.Success(&single_agent.PublishSingleAgentResponse{}), nil
}

func (s *Service) ListSingleAgentInfos(
	ctx context.Context, req *single_agent.ListSingleAgentInfosRequest,
) (*single_agent.ListSingleAgentInfosResponse, error) {
	agents, err := s.listVisibleAgents(ctx, req.OrganizationId, req.PublishStatusArr, req.Intent)
	if err != nil {
		return nil, err
	}

	infos := make([]*single_agent.SingleAgentInfo, 0, len(agents))
	for _, a := range agents {
		if a.Role == "" {
			continue
		}
		infos = append(infos, &single_agent.SingleAgentInfo{
			AgentId:         a.AgentId,
			Role:            a.Role,
			Name:            a.Name,
			CreatorUsername: a.CreatorUsername,
		})
	}

	return appresp.Success(&single_agent.ListSingleAgentInfosResponse{
		Data: &single_agent.ListSingleAgentInfosData{AgentInfos: infos},
	}), nil
}

func (s *Service) withRepositories(
	ctx context.Context,
	fn func(
		agentRepo repository.SingleAgentRepository,
		instanceRepo repository.SingleAgentInstanceRepository,
	) error,
) error {
	if s.DB == nil {
		return fn(s.SingleAgentRepo, s.SingleAgentInstanceRepo)
	}

	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return fn(
			repository.NewSingleAgentRepo(tx),
			repository.NewSingleAgentInstanceRepo(tx),
		)
	})
}

func (s *Service) ListRoles(_ context.Context) (*single_agent.ListRolesResponse, error) {
	return appresp.Success(&single_agent.ListRolesResponse{
		Data: &single_agent.ListRolesData{Roles: enum.AllAgentRoles()},
	}), nil
}

func (s *Service) ListSingleAgents(
	ctx context.Context, req *single_agent.ListSingleAgentsRequest,
) (*single_agent.ListSingleAgentsResponse, error) {
	agents, err := s.listVisibleAgents(ctx, req.OrganizationId, req.PublishStatusArr, req.Intent)
	if err != nil {
		return nil, err
	}

	pbAgents := make([]*single_agent.SingleAgent, len(agents))
	for i, agent := range agents {
		cdnIconUri, err := storage.PathToUrl(agent.IconUri)
		if err != nil {
			logger.CtxWarn(ctx, "failed to convert icon to CDN, err:%v", err)
		} else {
			agent.IconUri = cdnIconUri
		}

		pbAgents[i] = agent.SingleAgent
	}

	return appresp.Success(&single_agent.ListSingleAgentsResponse{
		Data: &single_agent.ListSingleAgentsData{
			Agents:  pbAgents,
			Total:   int32(len(pbAgents)),
			HasNext: false,
		},
	}), nil
}

// listVisibleAgents resolves the caller's agent-visibility grants and returns the
// agents they may see. When intent is DEPLOY, published platform-prebuilt agents
// (organization_id = 0) are visible to all authenticated users; otherwise only
// platform admins can see them.
func (s *Service) listVisibleAgents(
	ctx context.Context,
	organizationID *int64,
	publishStatusArr []single_agent.SingleAgentPublishStatus,
	intent single_agent.ListAgentIntent,
) ([]*entity.SingleAgent, error) {
	filter := &entity.ListSingleAgentFilter{
		PublishStatuses: publishStatusesOrDefault(publishStatusArr),
		OrganizationID:  organizationID,
	}

	if !rbac.Initialized() {
		filter.Unrestricted = true
		agents, _, err := s.SingleAgentRepo.ListByFilter(ctx, filter)
		return agents, err
	}

	filter.OwnerUsername = middleware.MustGetUsernameFromCtx(ctx)
	if rbac.IsPlatformAdmin(ctx) {
		filter.IncludeOrgFreeAgents = true
	} else if intent == single_agent.ListAgentIntent_LIST_AGENT_INTENT_DEPLOY {
		filter.IncludeOrgFreePublishedOnly = true
	}
	orgIDs, err := rbac.ListOrgIDsWithPermission(ctx, "sicodev", "entry")
	if err != nil {
		return nil, err
	}
	filter.VisibleOrgIDs = orgIDs
	managed, err := rbac.ListAgentIDsWithPermission(ctx, "agent", "manage")
	if err != nil {
		return nil, err
	}
	filter.ManagedAgentIDs = managed

	agents, _, err := s.SingleAgentRepo.ListByFilter(ctx, filter)
	return agents, err
}

func publishStatusesOrDefault(arr []single_agent.SingleAgentPublishStatus) []int32 {
	if len(arr) == 0 {
		return []int32{int32(single_agent.SingleAgentPublishStatus_SINGLE_AGENT_PUBLISH_STATUS_PUBLISHED)}
	}
	out := make([]int32, 0, len(arr))
	for _, st := range arr {
		out = append(out, int32(st))
	}
	return out
}

// CheckAgentVisibility returns nil if the context user may view the given agent.
// Visibility is status-agnostic (owners/managers can see their own drafts): the
// caller is allowed if they own the agent, hold agent.manage on it, are a platform
// admin for an organization-free agent, or hold sicodev.entry in the agent's org.
func (s *Service) CheckAgentVisibility(ctx context.Context, agentID string) error {
	if agentID == "" {
		return apperr.New(errcode.CommonInvalidParam, "agentId is required")
	}

	agent, err := s.getSingleAgent(ctx, agentID)
	if err != nil {
		return err
	}
	if agent == nil {
		return apperr.New(errcode.CommonNotFound, "agent not found")
	}

	if !rbac.Initialized() {
		return nil
	}

	username := middleware.MustGetUsernameFromCtx(ctx)
	if agent.CreatorUsername == username {
		return nil
	}
	if err := rbac.CheckCtxAccessScoped(ctx, rbac.ScopeAgent, agentID, "agent", "manage"); err == nil {
		return nil
	}
	if agent.OrganizationId == 0 && rbac.IsPlatformAdmin(ctx) {
		return nil
	}
	if agent.OrganizationId > 0 {
		orgID := strconv.FormatInt(agent.OrganizationId, 10)
		if err := rbac.CheckCtxAccessScoped(ctx, rbac.ScopeOrg, orgID, "sicodev", "entry"); err == nil {
			return nil
		}
	}

	return apperr.New(errcode.CommonForbidden, "forbidden")
}

// CheckAgentOwner returns nil only if the context user is the creator (owner) of
// the given agent. It authorizes agent-scoped role changes (adding or removing an
// agent editor). Returns nil when RBAC is not initialized (e.g. in tests).
func (s *Service) CheckAgentOwner(ctx context.Context, agentID string) error {
	if agentID == "" {
		return apperr.New(errcode.CommonInvalidParam, "agentId is required")
	}

	agent, err := s.getSingleAgent(ctx, agentID)
	if err != nil {
		return err
	}
	if agent == nil {
		return apperr.New(errcode.CommonNotFound, "agent not found")
	}

	if !rbac.Initialized() {
		return nil
	}

	if agent.CreatorUsername != middleware.MustGetUsernameFromCtx(ctx) {
		return apperr.New(errcode.CommonForbidden, "only the agent owner can manage agent editors")
	}
	return nil
}

// CheckAgentManageAccess returns nil if the context user may manage the given agent
// (is its creator/owner or holds agent.manage). It authorizes the management views
// of an agent (GET/PUT of its config); runtime/chat flows only require project-scoped
// dw.use and must not be gated by this check.
func (s *Service) CheckAgentManageAccess(ctx context.Context, agentID string) error {
	if agentID == "" {
		return apperr.New(errcode.CommonInvalidParam, "agentId is required")
	}
	agent, err := s.getSingleAgent(ctx, agentID)
	if err != nil {
		return err
	}
	if agent == nil {
		return apperr.New(errcode.CommonNotFound, "agent not found")
	}
	return rbac.CheckCtxAccessScopedOrIsOwner(
		ctx, rbac.ScopeAgent, agentID, "agent", "manage", agent.CreatorUsername,
	)
}

func (s *Service) DeploySingleAgent(
	ctx context.Context,
	req *single_agent.DeploySingleAgentRequest,
	operatorUsername string,
) (*single_agent.DeploySingleAgentResponse, error) {
	if req.AgentId == "" {
		return nil, apperr.New(errcode.CommonInvalidParam, "agentId is required")
	}
	if req.Name == "" {
		return nil, apperr.New(errcode.CommonInvalidParam, "name is required")
	}

	agent, err := s.getSingleAgent(ctx, req.AgentId)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperr.New(errcode.CommonNotFound, "agent not found")
		}
		return nil, err
	}
	if agent == nil {
		return nil, apperr.New(errcode.CommonNotFound, "agent not found")
	}

	rawIconURI := agent.RawIconUri
	iconURI := agent.IconUri
	if rawIconURI == "" {
		rawIconURI = iconURI
	}
	if iconURI == "" {
		iconURI = rawIconURI
	}

	instanceEntity := &entity.SingleAgentInstance{
		SingleAgentInstance: &single_agent.SingleAgentInstance{
			AgentId:          req.AgentId,
			EmployerUsername: operatorUsername,
			OperatorUsername: operatorUsername,
			Name:             req.Name,
			Role:             agent.Role,
			Desc:             agent.Desc,
			RawIconUri:       rawIconURI,
			IconUri:          iconURI,
		},
	}

	id, err := s.createSingleAgentInstance(ctx, instanceEntity)
	if err != nil {
		return nil, err
	}

	return appresp.Success(&single_agent.DeploySingleAgentResponse{
		Data: &single_agent.DeploySingleAgentData{
			Id:               id,
			AgentId:          req.AgentId,
			EmployerUsername: operatorUsername,
		},
	}), nil
}

func (s *Service) CreateSingleAgentInstance(
	ctx context.Context, req *single_agent.CreateSingleAgentInstanceRequest,
) (*single_agent.CreateSingleAgentInstanceResponse, error) {
	agentID := req.AgentId
	if len(agentID) == 0 {
		return nil, apperr.New(errcode.CommonInvalidParam, "agentId is required")
	}

	if req.ProjectId > 0 {
		if err := rbac.CheckCtxAccess(ctx, rbac.ScopeProject, req.ProjectId, "dw", "manage"); err != nil {
			return nil, err
		}
	}

	instanceEntity := &entity.SingleAgentInstance{
		SingleAgentInstance: &single_agent.SingleAgentInstance{
			AgentId:          agentID,
			EmployerUsername: req.EmployerUsername,
			OperatorUsername: req.OperatorUsername,
			Name:             req.Name,
			Desc:             req.Desc,
			IconUri:          req.IconUri,
			Role:             req.Role,
			ProjectId:        req.ProjectId,
			Status:           single_agent.SingleAgentInstanceStatus_INSTANCE_ACTIVE,
		},
	}

	id, err := s.createSingleAgentInstance(ctx, instanceEntity)
	if err != nil {
		return nil, err
	}

	err = s.populateOnboardKnowledge(ctx, id)
	if err != nil {
		return nil, err
	}

	return appresp.Success(&single_agent.CreateSingleAgentInstanceResponse{
		Data: &single_agent.CreateSingleAgentInstanceData{
			Id:               id,
			EmployerUsername: req.EmployerUsername,
			AgentId:          agentID,
		},
	}), nil
}

// GetSingleAgentInstance satisfies the agent.Service interface.
func (s *Service) GetSingleAgentInstance(
	ctx context.Context, id int64,
) (*entity.SingleAgentInstance, error) {
	return s.getSingleAgentInstance(ctx, id)
}

func (s *Service) GetSingleAgentInstanceHTTP(
	ctx context.Context, req *single_agent.GetSingleAgentInstanceRequest,
) (*single_agent.GetSingleAgentInstanceResponse, error) {
	instance, err := s.getSingleAgentInstance(ctx, req.Id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperr.New(errcode.CommonNotFound, "agent instance not found")
		}
		return nil, err
	}
	if instance == nil {
		return nil, apperr.New(errcode.CommonNotFound, "agent instance not found")
	}

	agent, err := s.getSingleAgent(ctx, instance.AgentId)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperr.New(errcode.CommonNotFound, "agent not found")
		}
		return nil, err
	}
	if agent == nil {
		return nil, apperr.New(errcode.CommonNotFound, "agent not found")
	}

	cdnIconUri, err := storage.PathToUrl(instance.IconUri)
	if err != nil {
		logger.CtxWarn(ctx, "failed to convert icon to CDN, err:%v", err)
	}
	instance.IconUri = cdnIconUri

	cdnEmployerIconUri, err := storage.PathToUrl(instance.EmployerIconUri)
	if err != nil {
		logger.CtxWarn(ctx, "failed to convert EmployerIconUri to CDN, err:%v", err)
	}
	instance.EmployerIconUri = cdnEmployerIconUri

	return appresp.Success(&single_agent.GetSingleAgentInstanceResponse{
		Data: &single_agent.GetSingleAgentInstanceData{Instance: instance.SingleAgentInstance},
	}), nil
}

func parseAssetIDFromURI(uri string) (int64, error) {
	cleaned := strings.TrimSpace(uri)
	if cleaned == "" {
		return 0, fmt.Errorf("empty attachment uri")
	}

	trimmed := strings.Trim(cleaned, "/")
	parts := strings.Split(trimmed, "/")
	objectKey := parts[len(parts)-1]
	if objectKey == "" {
		return 0, fmt.Errorf("invalid attachment uri: %s", uri)
	}

	idPart := strings.SplitN(objectKey, ".", 2)[0]
	assetID, err := strconv.ParseInt(idPart, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("parse asset id from uri %s: %w", uri, err)
	}

	return assetID, nil
}

func (s *Service) populateOnboardKnowledge(ctx context.Context, instanceID int64) error {
	instance, err := s.getSingleAgentInstance(ctx, instanceID)
	if err != nil {
		return err
	}

	if instance.ProjectId == 0 {
		return apperr.New(errcode.CommonInvalidParam, "projectId is required to create knowledge documents")
	}

	knowledgeSvc := knowledgebiz.Default()
	if knowledgeSvc == nil {
		return apperr.New(errcode.CommonUnavailable, "knowledge service not initialized")
	}

	for _, att := range instance.Attachments {
		if att == nil {
			continue
		}

		uri := strings.TrimSpace(att.Uri)
		if uri == "" {
			continue
		}

		// Treat remote links as link-type knowledge documents.
		if strings.HasPrefix(uri, "http://") || strings.HasPrefix(uri, "https://") {
			if _, err := knowledgeSvc.CreateDocument(ctx, &knowledge.CreateKnowledgeDocumentRequest{
				ProjectId:    instance.ProjectId,
				AgentId:      instance.AgentId,
				LinkUrl:      uri,
				DocumentType: knowledge.KnowledgeDocumentType_KNOWLEDGE_DOCUMENT_TYPE_LINK,
			}); err != nil {
				return err
			}
			continue
		}

		assetID, err := parseAssetIDFromURI(uri)
		if err != nil {
			return err
		}

		if _, err := knowledgeSvc.CreateDocument(ctx, &knowledge.CreateKnowledgeDocumentRequest{
			ProjectId:    instance.ProjectId,
			AgentId:      instance.AgentId,
			AssetId:      assetID,
			DocumentType: knowledge.KnowledgeDocumentType_KNOWLEDGE_DOCUMENT_TYPE_FILE,
		}); err != nil {
			return err
		}
	}

	return nil
}

func (s *Service) UpdateSingleAgentInstance(
	ctx context.Context, req *single_agent.UpdateSingleAgentInstanceRequest,
) (resp *single_agent.UpdateSingleAgentInstanceResponse, err error) {
	previousEntity, err := s.getSingleAgentInstance(ctx, req.Id)
	if err != nil {
		return nil, err
	}

	projectID := req.ProjectId
	if projectID == 0 {
		projectID = previousEntity.ProjectId
	}
	if projectID != 0 {
		if err := rbac.CheckCtxAccessOrOwner(
			ctx, rbac.ScopeProject, projectID,
			"dw", "manage", previousEntity.EmployerUsername,
		); err != nil {
			return nil, err
		}
	}

	// Convert request to domain entity
	instanceEntity := &entity.SingleAgentInstance{
		SingleAgentInstance: &single_agent.SingleAgentInstance{
			Id:               req.Id,
			OperatorUsername: req.OperatorUsername,
			Permission:       req.Permission,
			Name:             req.Name,
			Attachments:      req.Attachments,
			Desc:             req.Desc,
			ProjectId:        req.ProjectId,
		},
	}

	err = s.updateSingleAgentInstance(ctx, instanceEntity)
	if err != nil {
		return nil, err
	}

	return appresp.Success(&single_agent.UpdateSingleAgentInstanceResponse{}), nil
}

func (s *Service) DeleteSingleAgentInstance(
	ctx context.Context, req *single_agent.DeleteSingleAgentInstanceRequest,
) (resp *single_agent.DeleteSingleAgentInstanceResponse, err error) {
	instance, err := s.getSingleAgentInstance(ctx, req.Id)
	if err != nil {
		return nil, err
	}
	if instance.ProjectId != 0 {
		if err := rbac.CheckCtxAccessOrOwner(
			ctx, rbac.ScopeProject, instance.ProjectId,
			"dw", "manage", instance.EmployerUsername,
		); err != nil {
			return nil, err
		}
	}

	err = s.deleteSingleAgentInstance(ctx, req.Id)
	if err != nil {
		return nil, err
	}

	return appresp.Success(&single_agent.DeleteSingleAgentInstanceResponse{}), nil
}

// DismissSingleAgentInstance deactivates a single agent instance by setting its status to INACTIVE.
// It first unbinds any idle sandboxes from the instance.
func (s *Service) DismissSingleAgentInstance(
	ctx context.Context, req *single_agent.DismissSingleAgentInstanceRequest,
) (*single_agent.DismissSingleAgentInstanceResponse, error) {
	instance, err := s.getSingleAgentInstance(ctx, req.Id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperr.New(errcode.CommonNotFound, "agent instance not found")
		}
		return nil, err
	}

	if instance.ProjectId > 0 {
		if err := rbac.CheckCtxAccessOrOwner(
			ctx, rbac.ScopeProject, instance.ProjectId,
			"dw", "manage", instance.EmployerUsername,
		); err != nil {
			return nil, err
		}
	}

	// Unbind sandboxes before dismissing.
	instanceID := strconv.FormatInt(req.Id, 10)
	if err := s.unassignInstanceSandboxesIfIdle(ctx, instanceID); err != nil {
		return nil, err
	}

	instanceEntity := &entity.SingleAgentInstance{
		SingleAgentInstance: &single_agent.SingleAgentInstance{
			Id:     req.Id,
			Status: single_agent.SingleAgentInstanceStatus_INSTANCE_INACTIVE,
		},
	}
	if err := s.updateSingleAgentInstance(ctx, instanceEntity); err != nil {
		return nil, err
	}

	notifyCtx := context.WithoutCancel(ctx)
	safego.Go(notifyCtx, func() {
		s.notifyDwAction(notifyCtx, instance, notificationdto.NotificationType_NOTIFICATION_TYPE_DW_DISMISSED, "", "")
	})

	return appresp.Success(&single_agent.DismissSingleAgentInstanceResponse{}), nil
}

// ReassignSingleAgentInstance reassigns a single agent instance to a new operator.
func (s *Service) ReassignSingleAgentInstance(
	ctx context.Context, req *single_agent.ReassignSingleAgentInstanceRequest,
) (*single_agent.ReassignSingleAgentInstanceResponse, error) {
	instance, err := s.getSingleAgentInstance(ctx, req.Id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperr.New(errcode.CommonNotFound, "agent instance not found")
		}
		return nil, err
	}

	if instance.ProjectId <= 0 {
		return nil, apperr.New(errcode.CommonInvalidParam, "agent instance has no project; cannot reassign")
	}

	if err := rbac.CheckCtxAccess(ctx, rbac.ScopeProject, instance.ProjectId, "project", "manage"); err != nil {
		return nil, err
	}

	oldOperator := instance.OperatorUsername
	instanceEntity := &entity.SingleAgentInstance{
		SingleAgentInstance: &single_agent.SingleAgentInstance{
			Id:               req.Id,
			OperatorUsername: req.NewOperatorUsername,
			Status:           single_agent.SingleAgentInstanceStatus_INSTANCE_ACTIVE,
		},
	}
	if err := s.updateSingleAgentInstance(ctx, instanceEntity); err != nil {
		return nil, err
	}

	notifyCtx := context.WithoutCancel(ctx)
	safego.Go(notifyCtx, func() {
		s.notifyDwAction(
			notifyCtx,
			instance,
			notificationdto.NotificationType_NOTIFICATION_TYPE_DW_REASSIGNED,
			oldOperator,
			req.NewOperatorUsername,
		)
	})

	return appresp.Success(&single_agent.ReassignSingleAgentInstanceResponse{}), nil
}

// unassignInstanceSandboxesIfIdle unassigns all idle sandboxes from an instance.
func (s *Service) unassignInstanceSandboxesIfIdle(ctx context.Context, instanceID string) error {
	hasAssigned, _, err := sandboxbiz.HasAssignedSandboxesStrict(ctx, instanceID)
	if err != nil {
		return err
	}
	if !hasAssigned {
		return nil
	}

	sandboxSvc := sandboxbiz.Default()
	if sandboxSvc == nil {
		return nil
	}

	return sandboxbiz.WithInstanceAssignmentLock(ctx, instanceID, func() error {
		return sandboxSvc.CleanupInstanceSandboxes(ctx, instanceID)
	})
}

func (s *Service) notifyDwAction(
	ctx context.Context,
	instance *entity.SingleAgentInstance,
	notifType notificationdto.NotificationType,
	oldOperator, newOperator string,
) {
	notifSvc := notificationbiz.Default()
	if notifSvc == nil {
		return
	}

	sender := middleware.MustGetUsernameFromCtx(ctx)
	projectName := ""
	if instance.Project != nil {
		projectName = instance.Project.Name
	}

	extraInfo := &notificationdto.NotificationExtraInfo{
		DwAction: &notificationdto.NotificationExtraInfoDwAction{
			AgentInstanceId:      instance.Id,
			AgentInstanceName:    instance.Name,
			ProjectName:          projectName,
			OldOperatorUsername:  oldOperator,
			NewOperatorUsername:  newOperator,
			AgentInstanceIconUri: instance.IconUri,
		},
	}

	recipients := make(map[string]struct{})
	if instance.EmployerUsername != "" && instance.EmployerUsername != sender {
		recipients[instance.EmployerUsername] = struct{}{}
	}
	if instance.OperatorUsername != "" && instance.OperatorUsername != sender {
		recipients[instance.OperatorUsername] = struct{}{}
	}
	if instance.ProjectId > 0 {
		admins, err := rbac.ListProjectAdminUsernames(ctx, []int64{instance.ProjectId})
		if err == nil {
			for _, name := range admins[instance.ProjectId] {
				if name != sender {
					recipients[name] = struct{}{}
				}
			}
		}
	}

	for username := range recipients {
		_, err := notifSvc.Create(ctx, &notificationEntity.Notification{
			Type:             notifType,
			SenderUsername:   sender,
			ReceiverUsername: username,
			ExtraInfo:        extraInfo,
			ProjectId:        instance.ProjectId,
		})
		if err != nil {
			logger.CtxError(ctx, "notifyDwAction: failed to notify %s: %v", username, err)
		}
	}
}

func (s *Service) ListSingleAgentInstancesByFilter(
	ctx context.Context, filter *entity.ListSingleAgentInstanceFilter, offset, limit int,
) (instances []*entity.SingleAgentInstance, total int64, err error) {
	if filter == nil {
		filter = &entity.ListSingleAgentInstanceFilter{}
	}

	instances, total, err = s.SingleAgentInstanceRepo.ListByFilter(ctx, filter, offset, limit)
	if err != nil {
		return nil, 0, apperr.New(errcode.AgentInstanceQueryDatabaseError,
			fmt.Sprintf("failed to list agent instances by filter: %v", err))
	}

	s.populateSingleAgentInstanceProjects(ctx, instances...)
	s.enrichSingleAgentInstances(ctx, instances)

	return instances, total, err
}

// enrichSingleAgentInstances converts icon URIs to CDN and populates capability tags from the agent.
func (s *Service) enrichSingleAgentInstances(ctx context.Context, instances []*entity.SingleAgentInstance) {
	for _, instance := range instances {
		cdnIconUri, err := storage.PathToUrl(instance.IconUri)
		if err != nil {
			logger.CtxWarn(ctx, "convert icon uri failed, err: %v", err)
		}
		instance.IconUri = cdnIconUri

		cdnEmployerIconUri, err := storage.PathToUrl(instance.EmployerIconUri)
		if err != nil {
			logger.CtxWarn(ctx, "convert EmployerIconUri failed, err: %v", err)
		}
		instance.EmployerIconUri = cdnEmployerIconUri
	}
}

func (s *Service) GetSingleAgentInstanceNames(ctx context.Context, ids []int64) (map[int64]string, error) {
	instances, err := s.SingleAgentInstanceRepo.MGet(ctx, ids)
	if err != nil {
		return nil, apperr.New(errcode.AgentInstanceQueryDatabaseError,
			fmt.Sprintf("failed to get agent instance names: %v", err))
	}
	nameMap := make(map[int64]string, len(instances))
	for _, inst := range instances {
		nameMap[inst.Id] = inst.Name
	}
	return nameMap, nil
}

func (s *Service) GetSingleAgentInstanceIconURIs(ctx context.Context, ids []int64) (map[int64]string, error) {
	instances, err := s.SingleAgentInstanceRepo.MGet(ctx, ids)
	if err != nil {
		return nil, apperr.New(errcode.AgentInstanceQueryDatabaseError,
			fmt.Sprintf("failed to get agent instance icon URIs: %v", err))
	}
	iconMap := make(map[int64]string, len(instances))
	for _, inst := range instances {
		iconMap[inst.Id] = inst.IconUri
	}
	return iconMap, nil
}

func (s *Service) UpdateSingleAgentInstanceStatus(
	ctx context.Context, req *single_agent.UpdateSingleAgentInstanceStatusRequest,
) (*single_agent.UpdateSingleAgentInstanceStatusResponse, error) {
	if err := s.SingleAgentInstanceRepo.UpdateStatus(ctx, req.Id, req.Status); err != nil {
		return nil, apperr.New(errcode.AgentInstanceQueryDatabaseError,
			fmt.Sprintf("failed to update agent instance status: %v", err))
	}
	return appresp.Success(&single_agent.UpdateSingleAgentInstanceStatusResponse{}), nil
}
