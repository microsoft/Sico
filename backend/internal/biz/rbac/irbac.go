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

package rbac

import (
	"context"

	"github.com/casbin/casbin/v2"

	"sico-backend/internal/transport/http/dto/rbac/casbin_rule"
	"sico-backend/internal/transport/http/dto/rbac/role"
	"sico-backend/internal/transport/http/dto/rbac/token"
	"sico-backend/internal/transport/http/dto/rbac/user"
	"sico-backend/internal/transport/http/dto/rbac/user_role"
	"sico-backend/pkg/jwtx"
)

// Service is the RBAC contract consumed by transport handlers.
type Service interface {
	CreateUser(ctx context.Context, req *user.CreateUserRequest) (*user.CreateUserResponse, error)
	UpdateUser(ctx context.Context, req *user.UpdateUserRequest) (*user.UpdateUserResponse, error)
	DeleteUser(ctx context.Context, req *user.DeleteUserRequest) (*user.DeleteUserResponse, error)
	GetUser(ctx context.Context, req *user.GetUserRequest) (*user.GetUserResponse, error)
	QueryUsers(ctx context.Context, req *user.QueryUsersRequest) (*user.QueryUsersResponse, error)
	ResetPassword(ctx context.Context, req *user.ResetPasswordRequest) (*user.ResetPasswordResponse, error)
	Login(ctx context.Context, req *token.LoginRequest) (*token.LoginResponse, error)
	Logout(ctx context.Context, token string) (*token.LogoutResponse, error)
	RefreshToken(ctx context.Context, oldToken string, userInfo *jwtx.UserInfo) (*token.RefreshTokenResponse, error)
	CreateRole(ctx context.Context, req *role.CreateRoleRequest) (*role.CreateRoleResponse, error)
	UpdateRole(ctx context.Context, req *role.UpdateRoleRequest) (*role.UpdateRoleResponse, error)
	DeleteRole(ctx context.Context, req *role.DeleteRoleRequest) (*role.DeleteRoleResponse, error)
	GetRole(ctx context.Context, req *role.GetRoleRequest) (*role.GetRoleResponse, error)
	QueryRoles(ctx context.Context, req *role.QueryRolesRequest) (*role.QueryRolesResponse, error)
	AssignUserRole(ctx context.Context, req *user_role.AssignUserRoleRequest) (*user_role.AssignUserRoleResponse, error)
	RemoveUserRole(ctx context.Context, req *user_role.RemoveUserRoleRequest) (*user_role.RemoveUserRoleResponse, error)
	ListUserRoles(ctx context.Context, req *user_role.ListUserRolesRequest) (*user_role.ListUserRolesResponse, error)
	ListUsersByRole(ctx context.Context, req *user_role.ListUsersByRoleRequest) (*user_role.ListUsersByRoleResponse, error)
	CreatePolicy(ctx context.Context, req *casbin_rule.CreatePolicyRequest) (*casbin_rule.CreatePolicyResponse, error)
	UpdatePolicy(ctx context.Context, req *casbin_rule.UpdatePolicyRequest) (*casbin_rule.UpdatePolicyResponse, error)
	DeletePolicy(ctx context.Context, req *casbin_rule.DeletePolicyRequest) (*casbin_rule.DeletePolicyResponse, error)
	GetPolicy(ctx context.Context, req *casbin_rule.GetPolicyRequest) (*casbin_rule.GetPolicyResponse, error)
	QueryPolicies(ctx context.Context, req *casbin_rule.QueryPoliciesRequest) (*casbin_rule.QueryPoliciesResponse, error)
	GetEnforcer() *casbin.Enforcer
}
