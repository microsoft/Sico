// Copyright (c) 2026 Sico Authors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

package errcode

// Error code conventions
//
// - Code is a stable int32 business error code (NOT HTTP status).
// - 0 means success.
// - Ranges are assigned by domain/module to avoid collisions.
//
// Format: 1MMEEE
//   1        : fixed prefix for backend business errors
//   MM (2d)  : module/domain id
//   EEE (3d) : error sequence within module
//
// Example:
//   100004 -> Common / resource not found
//
// Module allocations (v1):
//   100000-100999: Common / cross-cutting
//   101000-101999: RBAC
//   102000-102999: Agent
//   103000-103999: Conversation
//   104000-104999: Knowledge
//   106000-106999: Project
//   110000-110999: LLM
//   112000-112999: Sandbox
//
// NOTE: modules are allocated by business domain (biz/entity), not by storage implementation.

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
	// Agent (102000-102999)
	AgentInvalidStatus              int32 = 102001
	AgentInstanceQueryDatabaseError int32 = 102003
)

const (
	// Conversation (103000-103999)
	ConversationChatServiceUnavailable int32 = 103001
	ConversationAgentInstanceRequired  int32 = 103002
	ConversationAgentRequired          int32 = 103003
)

const (
	// Knowledge (104000-104999)
	KnowledgeNameAlreadyExists         int32 = 104001
	KnowledgeDocumentURIAlreadyExists  int32 = 104002
	KnowledgeNotActive                 int32 = 104003
	KnowledgeCannotDeleteWithDocuments int32 = 104004
)

const (
	// Notification (105000-105999)
	NotificationInvalidReceiver int32 = 105001
)

const (
	// LLM (110000-110999)
	LLMGenerateFailed int32 = 110001

	// LLMHub (110100-110199)
	LLMHubInvalidStatus int32 = 110101
	LLMHubInvalidConfig int32 = 110102
	LLMHubRuntimeFailed int32 = 110103
	LLMHubModelNotFound int32 = 110104
)

const (
	// Sandbox (112000-112999)
	SandboxNoAvailableResource int32 = 112001
	SandboxLeaseNotFound       int32 = 112002
	SandboxProviderUnavailable int32 = 112003
	SandboxResetFailed         int32 = 112004
)
