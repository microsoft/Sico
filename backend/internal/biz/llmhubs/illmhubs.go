package llmhubs

import (
	"context"

	llmhubpb "sico-backend/internal/transport/grpc/pb/llmhubs"
	dto "sico-backend/internal/transport/http/dto/llmhubs"
)

// Service defines the core LLMHub application contract.
type Service interface {
	// Runtime
	RuntimeGenerate(ctx context.Context, req *dto.RuntimeGenerateRequest) (*dto.RuntimeGenerateResponse, error)
	RuntimeGenerateStream(
		ctx context.Context,
		req *dto.RuntimeGenerateRequest,
		onChunk func(chunk *dto.RuntimeStreamChunk) error,
	) error

	// Builtin models
	ListBuiltinModels(ctx context.Context) ([]*dto.ModelRegistryEntry, error)

	// Registry CRUD
	CreateModel(ctx context.Context, req *dto.CreateModelRegistryRequest) (*dto.CreateModelRegistryResponse, error)
	DeleteModel(ctx context.Context, req *dto.DeleteModelRegistryRequest) (*dto.DeleteModelRegistryResponse, error)
	ListModels(ctx context.Context, req *dto.ListModelRegistryRequest) (*dto.ListModelRegistryResponse, error)

	// Organization LLM config
	SetOrganizationLLMConfig(
		ctx context.Context, req *dto.SetOrganizationLLMConfigRequest,
	) (*dto.SetOrganizationLLMConfigResponse, error)
	GetOrganizationLLMConfig(
		ctx context.Context, req *dto.GetOrganizationLLMConfigRequest,
	) (*dto.GetOrganizationLLMConfigResponse, error)

	// ResolveRuntimeModelDefinition resolves a custom model's runtime definition
	// (nil for builtin models).
	ResolveRuntimeModelDefinition(ctx context.Context, modelKey string) (*llmhubpb.RuntimeModelDefinition, error)
}

var defaultSvc Service

// Default returns the singleton LLMHub service.
func Default() Service {
	return defaultSvc
}

func setDefault(svc Service) {
	defaultSvc = svc
}
