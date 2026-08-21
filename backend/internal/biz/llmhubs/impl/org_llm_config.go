package impl

import (
	"context"
	"strings"

	"sico-backend/internal/errcode"
	"sico-backend/internal/shared/apperr"
	orgrepo "sico-backend/internal/store/organization/repository"
	llmhubpb "sico-backend/internal/transport/grpc/pb/llmhubs"
	dto "sico-backend/internal/transport/http/dto/llmhubs"
)

// SetOrganizationLLMConfig sets the default model key for an organization.
func (s *Service) SetOrganizationLLMConfig(
	ctx context.Context, req *dto.SetOrganizationLLMConfigRequest,
) (*dto.SetOrganizationLLMConfigResponse, error) {
	if req.OrganizationId <= 0 {
		return nil, apperr.New(errcode.CommonInvalidParam, "organizationId is required")
	}
	if s.OrgLLMConfigRepo == nil {
		return nil, apperr.New(errcode.CommonUnavailable, "organization llm config store not initialized")
	}
	if req.DefaultModelKey == nil {
		existing, err := s.OrgLLMConfigRepo.Get(ctx, req.OrganizationId)
		if err != nil {
			return nil, apperr.Wrap(errcode.CommonInternalError, "failed to read org llm config", err)
		}
		if existing == nil {
			return &dto.SetOrganizationLLMConfigResponse{
				Data: &dto.OrganizationLLMConfigData{Config: nil},
			}, nil
		}
		return &dto.SetOrganizationLLMConfigResponse{
			Data: &dto.OrganizationLLMConfigData{Config: orgConfigToDTO(req.OrganizationId, existing)},
		}, nil
	}

	modelKey := strings.TrimSpace(*req.DefaultModelKey)
	if modelKey == "" {
		if err := s.OrgLLMConfigRepo.Delete(ctx, req.OrganizationId); err != nil {
			return nil, apperr.Wrap(errcode.CommonInternalError, "failed to clear org llm config", err)
		}
		return &dto.SetOrganizationLLMConfigResponse{
			Data: &dto.OrganizationLLMConfigData{Config: nil},
		}, nil
	}

	if err := s.OrgLLMConfigRepo.Upsert(ctx, &orgrepo.OrganizationLLMConfigModel{
		OrganizationID:  req.OrganizationId,
		DefaultModelKey: modelKey,
	}); err != nil {
		return nil, apperr.Wrap(errcode.CommonInternalError, "failed to save organization llm config", err)
	}

	cfg, err := s.OrgLLMConfigRepo.Get(ctx, req.OrganizationId)
	if err != nil {
		return nil, apperr.Wrap(errcode.CommonInternalError, "failed to load organization llm config", err)
	}

	return &dto.SetOrganizationLLMConfigResponse{
		Data: &dto.OrganizationLLMConfigData{Config: orgConfigToDTO(req.OrganizationId, cfg)},
	}, nil
}

// GetOrganizationLLMConfig returns the default model config for an organization.
// When no config exists, the returned config carries only the organization ID
// with an empty default model key.
func (s *Service) GetOrganizationLLMConfig(
	ctx context.Context, req *dto.GetOrganizationLLMConfigRequest,
) (*dto.GetOrganizationLLMConfigResponse, error) {
	if req.OrganizationId <= 0 {
		return nil, apperr.New(errcode.CommonInvalidParam, "organizationId is required")
	}
	if s.OrgLLMConfigRepo == nil {
		return nil, apperr.New(errcode.CommonUnavailable, "organization llm config store not initialized")
	}

	cfg, err := s.OrgLLMConfigRepo.Get(ctx, req.OrganizationId)
	if err != nil {
		return nil, apperr.Wrap(errcode.CommonInternalError, "failed to load organization llm config", err)
	}

	return &dto.GetOrganizationLLMConfigResponse{
		Data: &dto.OrganizationLLMConfigData{Config: orgConfigToDTO(req.OrganizationId, cfg)},
	}, nil
}

// ResolveRuntimeModelDefinition resolves the runtime model definition for a custom
// (registered) model. Returns nil for builtin models so core can resolve them from
// its own YAML catalog.
func (s *Service) ResolveRuntimeModelDefinition(
	ctx context.Context, modelKey string,
) (*llmhubpb.RuntimeModelDefinition, error) {
	return s.resolveRuntimeModelDefinition(ctx, modelKey)
}

func orgConfigToDTO(orgID int64, cfg *orgrepo.OrganizationLLMConfigModel) *dto.OrganizationLLMConfig {
	if cfg == nil {
		return &dto.OrganizationLLMConfig{OrganizationId: orgID}
	}
	return &dto.OrganizationLLMConfig{
		OrganizationId:  cfg.OrganizationID,
		DefaultModelKey: cfg.DefaultModelKey,
		CreatedAt:       cfg.CreatedAt,
		UpdatedAt:       cfg.UpdatedAt,
	}
}
