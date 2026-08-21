package skill

import (
	"context"

	"sico-backend/internal/transport/http/dto/skill"
)

// Service defines the skill application contract consumed by transport handlers.
type Service interface {
	CreateSkill(ctx context.Context, req *skill.CreateSkillRequest) (*skill.CreateSkillResponse, error)
	GetSkill(ctx context.Context, req *skill.GetSkillRequest) (*skill.GetSkillResponse, error)
	UpdateSkill(ctx context.Context, req *skill.UpdateSkillRequest) (*skill.UpdateSkillResponse, error)
	DeleteSkill(ctx context.Context, req *skill.DeleteSkillRequest) (*skill.DeleteSkillResponse, error)
	ListSkills(ctx context.Context, req *skill.ListSkillRequest) (*skill.ListSkillResponse, error)
}

var defaultSvc Service

// Default returns the singleton skill application service.
func Default() Service {
	return defaultSvc
}

func setDefault(svc Service) {
	defaultSvc = svc
}
