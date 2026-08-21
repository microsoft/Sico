package singleagent

// ListSingleAgentFilter captures the agent-visibility predicates resolved by the
// biz layer and applied by the store as a single query.
//
// The visibility groups are OR-ed together; a row is visible if it matches any
// populated group. When no visibility group is populated (and Unrestricted is
// false) the query matches nothing. The remaining fields are AND-ed on top.
type ListSingleAgentFilter struct {
	// Unrestricted bypasses the visibility union entirely (used when RBAC is not
	// initialized, e.g. in tests) so all agents are returned.
	Unrestricted bool

	// --- visibility union (OR of the populated groups) ---
	// IncludeOrgFreeAgents matches organization_id = 0 (platform-predefined agents).
	IncludeOrgFreeAgents bool
	// IncludeOrgFreePublishedOnly matches organization_id = 0 AND publish_status = PUBLISHED.
	IncludeOrgFreePublishedOnly bool
	// VisibleOrgIDs matches organization_id IN (...) (orgs where the user has sicodev.entry).
	VisibleOrgIDs []int64
	// OwnerUsername matches creator_username = OwnerUsername (owned agents).
	OwnerUsername string
	// ManagedAgentIDs matches agent_id IN (...) (agents where the user has agent.manage).
	ManagedAgentIDs []string

	// --- global AND filters ---
	// PublishStatuses matches publish_status IN (...); empty means no status filter.
	PublishStatuses []int32
	// OrganizationID, when set, narrows results to a single organization.
	OrganizationID *int64
}
