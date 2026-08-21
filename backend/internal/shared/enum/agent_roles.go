package enum

type AgentRole int

const (
	AgentRoleUnknown AgentRole = iota
	AgentRoleAssistant
	AgentRoleAndroidTester
	AgentRole3DArtist
	AgentRoleProductManager
	AgentRoleMarketing
)

func (s AgentRole) String() string {
	switch s {
	case AgentRoleAssistant:
		return "Assistant"
	case AgentRoleAndroidTester:
		return "Android Tester"
	case AgentRole3DArtist:
		return "3D Artist"
	case AgentRoleProductManager:
		return "Product Manager"
	case AgentRoleMarketing:
		return "Marketing"
	default:
		return "Unknown"
	}
}

func AllAgentRoles() []string {
	return []string{
		AgentRoleAssistant.String(),
		AgentRoleAndroidTester.String(),
		AgentRole3DArtist.String(),
		AgentRoleProductManager.String(),
		AgentRoleMarketing.String(),
	}
}
