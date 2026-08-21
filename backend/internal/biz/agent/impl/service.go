package impl

import (
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
