package singleagent

import (
	"sico-backend/internal/transport/http/dto/agent/single_agent"
)

type SingleAgentInstance struct {
	*single_agent.SingleAgentInstance
}

type ListSingleAgentInstanceFilter = single_agent.ListSingleAgentInstanceFilter
