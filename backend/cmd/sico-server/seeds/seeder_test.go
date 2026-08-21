package seeds

import (
	"testing"

	"github.com/stretchr/testify/require"

	agententity "sico-backend/internal/entity/agent/singleagent"
	agentdto "sico-backend/internal/transport/http/dto/agent/single_agent"
)

func TestDefaultAgentInstancesAreActive(t *testing.T) {
	factories := []func(string) (*agententity.SingleAgent, *agententity.SingleAgentInstance){
		getAgentSimpleChat,
		getAgentAndroidTester,
		getAgent3DArtist,
		getAgentProductManager,
		getAgentMarketing,
	}

	for _, factory := range factories {
		_, instance := factory("icon.svg")
		require.Equal(t, agentdto.SingleAgentInstanceStatus_INSTANCE_ACTIVE, instance.Status)
	}
}
