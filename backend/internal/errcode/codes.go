package errcode

const (
	OK int32 = 0
)

const (
	// Common (100000-100999)
	CommonInternalError int32 = 100000
	CommonInvalidParam  int32 = 100001
	CommonUnauthorized  int32 = 100002
	CommonForbidden     int32 = 100003
	CommonNotFound      int32 = 100004
	CommonConflict      int32 = 100005
	CommonUnavailable   int32 = 100006
)

const (
	// RBAC (101000-101999)
	RBACUsernameAlreadyExists int32 = 101001
	RBACEmailAlreadyExists    int32 = 101002
	RBACRoleCodeAlreadyExists int32 = 101003
	RBACRoleAlreadyAssigned   int32 = 101004
	RBACPolicyAlreadyExists   int32 = 101005
	RBACPolicyUpdateFailed    int32 = 101006
	RBACAccountInactive       int32 = 101007
	RBACIncorrectPassword     int32 = 101008
	RBACIncorrectOldPassword  int32 = 101009
	RBACCasbinNotInitialized  int32 = 101010
)

const (
	// LLMHub (110100-110199)
	LLMHubRuntimeFailed int32 = 110103
	LLMHubInvalidConfig int32 = 110104
	LLMHubInvalidStatus int32 = 110105
)

const (
	// Sandbox (112000-112999)
	SandboxNoAvailableResource      int32 = 112001
	SandboxLeaseNotFound            int32 = 112002
	SandboxProviderUnavailable      int32 = 112003
	SandboxResetFailed              int32 = 112004
	SandboxAlreadyAssignedToOrg     int32 = 112010
	SandboxNotAssignedToOrg         int32 = 112011
	SandboxHasProjectBindings       int32 = 112012
	SandboxAlreadyAssignedToProject int32 = 112013
	SandboxNotAssignedToProject     int32 = 112014
	SandboxNotInOrg                 int32 = 112015
	SandboxHasInstanceBindings      int32 = 112016
	SandboxProjectMismatch          int32 = 112017
)
