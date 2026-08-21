package singleagent

import (
	"sico-backend/internal/transport/http/dto/agent/single_agent"
)

// SingleAgent Use composition instead of aliasing for entities to enhance extensibility
type SingleAgent struct {
	*single_agent.SingleAgent
}

type InstantiatedAgent struct {
	MergedAgent *SingleAgent `json:"merged"`
	InstanceId  int64        `json:"instanceId"`
}

type AgentInstanceIdentity struct {
	AgentInstanceID int64
}
