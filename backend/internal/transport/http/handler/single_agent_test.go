package handler

import (
	"testing"

	"github.com/stretchr/testify/require"

	"sico-backend/internal/transport/http/dto/agent/single_agent"
)

func TestParseSingleAgentInstanceStatusList(t *testing.T) {
	statuses := parseSingleAgentInstanceStatusList("1,2,3,5,7")

	require.Equal(t, []single_agent.SingleAgentInstanceStatus{
		single_agent.SingleAgentInstanceStatus_INSTANCE_ONBOARDING,
		single_agent.SingleAgentInstanceStatus_INSTANCE_NEW,
		single_agent.SingleAgentInstanceStatus_INSTANCE_ACTIVE,
		single_agent.SingleAgentInstanceStatus_INSTANCE_ABORTED,
		single_agent.SingleAgentInstanceStatus_INSTANCE_ONBOARDING_SAVED,
	}, statuses)
	require.True(t, validateSingleAgentInstanceStatus(statuses...))
	require.False(t, validateSingleAgentInstanceStatus(single_agent.SingleAgentInstanceStatus_INSTANCE_UNKNOWN))
}
