package llmhubs

import (
	"github.com/google/wire"
	"google.golang.org/grpc"
	"gorm.io/gorm"

	"sico-backend/internal/biz/llmhubs/impl"
	registryrepo "sico-backend/internal/store/llmhubs/repository"
	orgrepo "sico-backend/internal/store/organization/repository"
)

// InitService wires the LLMHub service and sets the default singleton.
func InitService(
	db *gorm.DB,
	coreGRPC *grpc.ClientConn,
	modelRepo registryrepo.ModelRegistryRepository,
	secretRepo registryrepo.ModelRegistrySecretRepository,
	orgCfgRepo orgrepo.OrganizationLLMConfigRepository,
) Service {
	svc := impl.NewService(&impl.Components{
		DB:                      db,
		CoreGRPC:                coreGRPC,
		ModelRegistryRepo:       modelRepo,
		ModelRegistrySecretRepo: secretRepo,
		OrgLLMConfigRepo:        orgCfgRepo,
	})
	tracedSvc := WithTracing(svc)
	setDefault(tracedSvc)
	return tracedSvc
}

// ProviderSet wires the LLMHub biz service and its store dependencies.
var ProviderSet = wire.NewSet(
	registryrepo.NewModelRegistryRepo,
	registryrepo.NewModelRegistrySecretRepo,
	orgrepo.NewOrganizationLLMConfigRepository,
	InitService,
)
