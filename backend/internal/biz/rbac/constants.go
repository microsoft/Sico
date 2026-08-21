package rbac

// Well-known role codes matching the seeded Casbin policy rules.
const (
	RolePlatformAdmin = "platform_admin"
	RoleOrgAdmin      = "org_admin"
	RoleOrgMember     = "org_member"
	RoleProjectAdmin  = "project_admin"
	RoleProjectMember = "project_member"
	RoleDeveloper     = "developer"
	RoleAgentEditor   = "agent_editor"
)

// Scope types used in domain formatting and t_user_role.scope_type.
const (
	ScopePlatform = "platform"
	ScopeOrg      = "org"
	ScopeProject  = "project"
	ScopeAgent    = "agent"
)
