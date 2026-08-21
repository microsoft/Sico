package dal

import (
	"testing"

	"github.com/stretchr/testify/require"

	entity "sico-backend/internal/entity/agent/singleagent"
	"sico-backend/internal/transport/http/dto/agent/single_agent"
)

func TestSingleAgentInstanceDo2PoPreservesStatus(t *testing.T) {
	dao := &SingleAgentInstanceDAO{}
	instance := &entity.SingleAgentInstance{
		SingleAgentInstance: &single_agent.SingleAgentInstance{
			Status: single_agent.SingleAgentInstanceStatus_INSTANCE_ACTIVE,
		},
	}

	persistenceModel := dao.singleAgentInstanceDo2Po(instance)

	require.Equal(t, int32(single_agent.SingleAgentInstanceStatus_INSTANCE_ACTIVE), persistenceModel.Status)
}
