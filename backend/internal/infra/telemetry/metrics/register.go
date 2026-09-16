package metrics

import "gorm.io/gorm"

func RegisterBusinessMetrics(db *gorm.DB) {
	RegisterAgentStats(db)
	RegisterRBACStats(db)
	RegisterOrgProjectStats(db)
	RegisterConversationStats(db)
	RegisterTaskRuntimeStats(db)
	InitConversationCounters()
	InitTaskRuntimeCounters()
}
