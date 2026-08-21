package impl_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	agentimpl "sico-backend/internal/biz/agent/impl"
	knowledgebiz "sico-backend/internal/biz/knowledge"
	knowledgeimpl "sico-backend/internal/biz/knowledge/impl"
	entity "sico-backend/internal/entity/agent/singleagent"
	agentrepo "sico-backend/internal/store/agent/singleagent/repository"
	"sico-backend/internal/transport/http/dto/agent/single_agent"
)

type createAgentRepo struct {
	agentrepo.SingleAgentRepository
	agent *entity.SingleAgent
}

func (r *createAgentRepo) Get(context.Context, string) (*entity.SingleAgent, error) {
	return r.agent, nil
}

type createInstanceRepo struct {
	agentrepo.SingleAgentInstanceRepository
	instance *entity.SingleAgentInstance
}

func (r *createInstanceRepo) Create(_ context.Context, instance *entity.SingleAgentInstance) (int64, error) {
	instance.Id = 1
	r.instance = instance
	return instance.Id, nil
}

func (r *createInstanceRepo) Get(context.Context, int64) (*entity.SingleAgentInstance, error) {
	return r.instance, nil
}

func TestCreateSingleAgentInstancePersistsOperatorAndActiveStatus(t *testing.T) {
	instanceRepo := &createInstanceRepo{}
	service := agentimpl.NewService(&agentimpl.Components{
		SingleAgentRepo: &createAgentRepo{agent: &entity.SingleAgent{
			SingleAgent: &single_agent.SingleAgent{AgentId: "agent-1"},
		}},
		SingleAgentInstanceRepo: instanceRepo,
	}, nil)
	knowledgebiz.InitService(&knowledgeimpl.Components{})

	_, err := service.CreateSingleAgentInstance(context.Background(), &single_agent.CreateSingleAgentInstanceRequest{
		AgentId:          "agent-1",
		EmployerUsername: "owner@sico.local",
		OperatorUsername: "operator@sico.local",
		Name:             "Worker",
		ProjectId:        10,
	})
	require.NoError(t, err)
	require.NotNil(t, instanceRepo.instance)
	require.Equal(t, "operator@sico.local", instanceRepo.instance.OperatorUsername)
	require.Equal(t, single_agent.SingleAgentInstanceStatus_INSTANCE_ACTIVE, instanceRepo.instance.Status)
}
