package impl

import (
	"context"

	"sico-backend/internal/biz/ownership"
	"sico-backend/internal/biz/rbac"
	"sico-backend/internal/infra/storage"
	"sico-backend/internal/store/agent/singleagent/repository"
	projectrepo "sico-backend/internal/store/project/repository"

	"gorm.io/gorm"
)

// Components aggregates infrastructure dependencies required by the agent service implementation.
type Components struct {
	SingleAgentRepo         repository.SingleAgentRepository
	SingleAgentInstanceRepo repository.SingleAgentInstanceRepository
	ProjectRepo             projectrepo.ProjectRepository
	Storage                 storage.Storage
	Access                  rbac.Access
	Ownership               ownership.Resolver
}

// Service orchestrates agent-related business workflows across repositories and external integrations.
type Service struct {
	*Components
	DB *gorm.DB
}

// NewService builds a concrete agent service implementation.
func NewService(components *Components, db *gorm.DB) *Service {
	return &Service{
		Components: components,
		DB:         db,
	}
}

func (s *Service) access() rbac.Access {
	if s != nil && s.Components != nil && s.Access != nil {
		return s.Access
	}
	return rbac.NewUninitializedAccessServices()
}

func (s *Service) requireOrganization(ctx context.Context, organizationID int64, allowGlobal bool) error {
	if s == nil || s.Components == nil || s.Ownership == nil {
		return nil
	}
	return s.Ownership.RequireOrganization(ctx, organizationID, allowGlobal)
}

func (s *Service) requireAgentOrganization(ctx context.Context, agentID string) error {
	if s == nil || s.Components == nil || s.Ownership == nil {
		return nil
	}
	organizationID, err := s.Ownership.AgentOrganization(ctx, agentID)
	if err != nil {
		return err
	}
	return s.Ownership.RequireOrganization(ctx, organizationID, true)
}

func (s *Service) requireProjectOrganization(ctx context.Context, projectID int64) error {
	if s == nil || s.Components == nil || s.Ownership == nil {
		return nil
	}
	organizationID, err := s.Ownership.ProjectOrganization(ctx, projectID)
	if err != nil {
		return err
	}
	return s.Ownership.RequireOrganization(ctx, organizationID, false)
}

func (s *Service) requireAgentInstanceOrganization(ctx context.Context, instanceID int64) error {
	if s == nil || s.Components == nil || s.Ownership == nil {
		return nil
	}
	organizationID, err := s.Ownership.AgentInstanceOrganization(ctx, instanceID)
	if err != nil {
		return err
	}
	return s.Ownership.RequireOrganization(ctx, organizationID, false)
}
