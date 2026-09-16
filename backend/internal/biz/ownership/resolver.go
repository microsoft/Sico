package ownership

import (
	"context"
	"fmt"

	"gorm.io/gorm"

	"sico-backend/internal/biz/rbac"
	"sico-backend/internal/errcode"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/tenantctx"
	agentrepo "sico-backend/internal/store/agent/singleagent/repository"
	conversationrepo "sico-backend/internal/store/conversation/conversation/repository"
	projectrepo "sico-backend/internal/store/project/repository"
	"sico-backend/internal/transport/http/middleware"
)

type Resolver interface {
	RequireSelected(ctx context.Context) (int64, error)
	RequireOrganization(ctx context.Context, organizationID int64, allowGlobal bool) error
	ProjectIDs(ctx context.Context, organizationID int64) ([]int64, error)
	ProjectOrganization(ctx context.Context, projectID int64) (int64, error)
	AgentOrganization(ctx context.Context, agentID string) (int64, error)
	AgentInstanceOrganization(ctx context.Context, instanceID int64) (int64, error)
	ConversationOrganization(ctx context.Context, conversationID int64) (int64, error)
}

type membershipAccess interface {
	GetUserOrganizationListByUsername(
		ctx context.Context,
		username, roleCodeFilter string,
	) ([]rbac.OrganizationMembership, error)
}

type resolver struct {
	access            membershipAccess
	projectRepo       projectrepo.ProjectRepository
	agentRepo         agentrepo.SingleAgentRepository
	agentInstanceRepo agentrepo.SingleAgentInstanceRepository
	conversationRepo  conversationrepo.ConversationRepo
}

func NewResolver(
	access rbac.Access,
	projectRepo projectrepo.ProjectRepository,
	agentRepo agentrepo.SingleAgentRepository,
	agentInstanceRepo agentrepo.SingleAgentInstanceRepository,
	conversationRepo conversationrepo.ConversationRepo,
) Resolver {
	return newResolver(access, projectRepo, agentRepo, agentInstanceRepo, conversationRepo)
}

func newResolver(
	access membershipAccess,
	projectRepo projectrepo.ProjectRepository,
	agentRepo agentrepo.SingleAgentRepository,
	agentInstanceRepo agentrepo.SingleAgentInstanceRepository,
	conversationRepo conversationrepo.ConversationRepo,
) Resolver {
	return &resolver{
		access: access, projectRepo: projectRepo, agentRepo: agentRepo,
		agentInstanceRepo: agentInstanceRepo, conversationRepo: conversationRepo,
	}
}

func (r *resolver) RequireSelected(ctx context.Context) (int64, error) {
	organizationID, ok := SelectedOrganization(ctx)
	if !ok {
		return 0, apperr.New(errcode.CommonInvalidParam, "selected organization is required")
	}

	username := middleware.MustGetUsernameFromCtx(ctx)
	memberships, err := r.access.GetUserOrganizationListByUsername(ctx, username, "")
	if err != nil {
		return 0, err
	}
	for _, membership := range memberships {
		if membership.OrganizationID == organizationID {
			return organizationID, nil
		}
	}
	return 0, apperr.New(errcode.CommonForbidden, "selected organization access denied")
}

func (r *resolver) RequireOrganization(ctx context.Context, organizationID int64, allowGlobal bool) error {
	if tenantctx.IsTrustedInternal(ctx) {
		return nil
	}
	if allowGlobal && organizationID == 0 {
		return nil
	}
	selectedOrganizationID, err := r.RequireSelected(ctx)
	if err != nil {
		return err
	}
	if organizationID != selectedOrganizationID {
		return apperr.New(errcode.CommonNotFound, "resource not found")
	}
	return nil
}

func (r *resolver) ProjectIDs(ctx context.Context, organizationID int64) ([]int64, error) {
	projects, _, err := r.projectRepo.ListProjects(ctx, &projectrepo.ProjectFilter{
		OrganizationID: &organizationID,
	}, 0, 0)
	if err != nil {
		return nil, fmt.Errorf("list organization projects: %w", err)
	}
	projectIDs := make([]int64, 0, len(projects))
	for _, project := range projects {
		projectIDs = append(projectIDs, project.ID)
	}
	return projectIDs, nil
}

func (r *resolver) ProjectOrganization(ctx context.Context, projectID int64) (int64, error) {
	project, err := r.projectRepo.GetProjectByID(ctx, projectID)
	if err != nil {
		return 0, ownershipLookupError("project", err)
	}
	if project == nil {
		return 0, apperr.New(errcode.CommonNotFound, "project not found")
	}
	return project.OrganizationID, nil
}

func (r *resolver) AgentOrganization(ctx context.Context, agentID string) (int64, error) {
	agent, err := r.agentRepo.Get(ctx, agentID)
	if err != nil {
		return 0, ownershipLookupError("agent", err)
	}
	if agent == nil {
		return 0, apperr.New(errcode.CommonNotFound, "agent not found")
	}
	return agent.OrganizationId, nil
}

func (r *resolver) AgentInstanceOrganization(ctx context.Context, instanceID int64) (int64, error) {
	instance, err := r.agentInstanceRepo.Get(ctx, instanceID)
	if err != nil {
		return 0, ownershipLookupError("agent instance", err)
	}
	if instance == nil {
		return 0, apperr.New(errcode.CommonNotFound, "agent instance not found")
	}
	return r.ProjectOrganization(ctx, instance.ProjectId)
}

func (r *resolver) ConversationOrganization(ctx context.Context, conversationID int64) (int64, error) {
	conversation, err := r.conversationRepo.GetByID(ctx, conversationID)
	if err != nil {
		return 0, ownershipLookupError("conversation", err)
	}
	if conversation == nil {
		return 0, apperr.New(errcode.CommonNotFound, "conversation not found")
	}
	return r.AgentInstanceOrganization(ctx, conversation.AgentInstanceID)
}

func ownershipLookupError(resource string, err error) error {
	if err == gorm.ErrRecordNotFound {
		return apperr.New(errcode.CommonNotFound, resource+" not found")
	}
	return fmt.Errorf("resolve %s organization: %w", resource, err)
}
