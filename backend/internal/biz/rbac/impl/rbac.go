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

package impl

import (
	"context"
	"errors"
	"fmt"

	"github.com/casbin/casbin/v2"
	"gorm.io/gorm"

	"sico-backend/internal/shared/apperr"
	appresp "sico-backend/internal/biz/common/response"
	entity "sico-backend/internal/entity/rbac"
	"sico-backend/internal/errcode"
	rolerepo "sico-backend/internal/store/rbac/repository"
	"sico-backend/internal/transport/http/dto/rbac/casbin_rule"
	rbacCommon "sico-backend/internal/transport/http/dto/rbac/common"
	"sico-backend/internal/transport/http/dto/rbac/role"
	"sico-backend/internal/transport/http/dto/rbac/token"
	"sico-backend/internal/transport/http/dto/rbac/user"
	"sico-backend/internal/transport/http/dto/rbac/user_role"
	"sico-backend/pkg/crypto/hash"
	"sico-backend/pkg/jwtx"
	"sico-backend/pkg/logger"
	"sico-backend/pkg/slicesx"
)

type Components struct {
	UserRepo     rolerepo.UserRepository
	RoleRepo     rolerepo.RoleRepository
	UserRoleRepo rolerepo.UserRoleRepository
	CasbinRepo   rolerepo.CasbinRuleRepository
	Enforcer     *casbin.Enforcer
}

type Service struct {
	*Components
	JWTAuth jwtx.Auther
}

// NewService wires the RBAC business service implementation.
func NewService(c *Components, jwtAuth jwtx.Auther) *Service {
	return &Service{
		Components: c,
		JWTAuth:    jwtAuth,
	}
}

// GetEnforcer exposes underlying Casbin enforcer for routing and middleware.
func (s *Service) GetEnforcer() *casbin.Enforcer { return s.Enforcer }

// CreateUser creates a new user.
func (s *Service) CreateUser(ctx context.Context, req *user.CreateUserRequest) (*user.CreateUserResponse, error) {
	if req == nil {
		return nil, apperr.New(errcode.CommonInvalidParam, "request is required")
	}

	id, err := s.doCreateUser(ctx, req)
	if err != nil {
		return nil, err
	}

	return appresp.Success(&user.CreateUserResponse{
		Data: &user.CreateUserResponseData{Id: id},
	}), nil
}

// UpdateUser updates an existing user.
func (s *Service) UpdateUser(ctx context.Context, req *user.UpdateUserRequest) (*user.UpdateUserResponse, error) {
	if req == nil {
		return nil, apperr.New(errcode.CommonInvalidParam, "request is required")
	}
	if req.Id <= 0 {
		return nil, apperr.New(errcode.CommonInvalidParam, "id is required")
	}

	if err := s.doUpdateUser(ctx, req); err != nil {
		return nil, err
	}

	return appresp.Success(&user.UpdateUserResponse{}), nil
}

// DeleteUser deletes a user by ID.
func (s *Service) DeleteUser(ctx context.Context, req *user.DeleteUserRequest) (*user.DeleteUserResponse, error) {
	if req == nil {
		return nil, apperr.New(errcode.CommonInvalidParam, "request is required")
	}
	if req.Id <= 0 {
		return nil, apperr.New(errcode.CommonInvalidParam, "id is required")
	}

	if err := s.doDeleteUser(ctx, req.Id); err != nil {
		return nil, err
	}

	return appresp.Success(&user.DeleteUserResponse{}), nil
}

// GetUser fetches a single user.
func (s *Service) GetUser(ctx context.Context, req *user.GetUserRequest) (*user.GetUserResponse, error) {
	if req == nil {
		return nil, apperr.New(errcode.CommonInvalidParam, "request is required")
	}
	if req.Username == "" {
		return nil, apperr.New(errcode.CommonInvalidParam, "username is required")
	}

	userEntity, err := s.doGetUser(ctx, req.Username)
	if err != nil {
		return nil, err
	}

	userRoles, _, _, err := s.doListUserRoles(ctx, &user_role.ListUserRolesRequest{UserId: userEntity.Id})
	if err != nil {
		return nil, err
	}

	for _, r := range userRoles {
		userEntity.Roles = append(userEntity.Roles, r.Code)
	}

	return appresp.Success(&user.GetUserResponse{
		Data: &user.GetUserResponseData{User: userEntity},
	}), nil
}

// QueryUsers queries users with pagination.
func (s *Service) QueryUsers(ctx context.Context, req *user.QueryUsersRequest) (*user.QueryUsersResponse, error) {
	if req == nil {
		return nil, apperr.New(errcode.CommonInvalidParam, "request is required")
	}

	users, total, hasNext, err := s.doQueryUsers(ctx, req)
	if err != nil {
		return nil, err
	}

	return appresp.Success(&user.QueryUsersResponse{
		Data: &user.QueryUsersResponseData{
			Users:   users,
			Total:   total,
			HasNext: hasNext,
		},
	}), nil
}

// ResetPassword resets a user password.
func (s *Service) ResetPassword(ctx context.Context, req *user.ResetPasswordRequest) (*user.ResetPasswordResponse, error) {
	if req == nil {
		return nil, apperr.New(errcode.CommonInvalidParam, "request is required")
	}
	if req.Id <= 0 {
		return nil, apperr.New(errcode.CommonInvalidParam, "id is required")
	}

	if err := s.doUpdatePassword(ctx, req.Id, req.OldPassword, req.NewPassword); err != nil {
		return nil, err
	}

	return appresp.Success(&user.ResetPasswordResponse{}), nil
}

// Login authenticates user credentials and returns token info.
func (s *Service) Login(ctx context.Context, req *token.LoginRequest) (*token.LoginResponse, error) {
	if req == nil {
		return nil, apperr.New(errcode.CommonInvalidParam, "request is required")
	}
	if req.Email == "" || req.Password == "" {
		return nil, apperr.New(errcode.CommonInvalidParam, "email and password are required")
	}

	userEntity, err := s.doGetUserByEmail(ctx, req.Email)
	if err != nil {
		// For security, avoid leaking whether the email exists.
		if ae, ok := apperr.As(err); ok {
			if ae.Code() == errcode.CommonNotFound {
				return nil, apperr.New(errcode.RBACIncorrectPassword, "invalid credentials")
			}
		}
		return nil, err
	}

	if userEntity.Status != rbacCommon.UserStatus_USER_STATUS_ACTIVE {
		return nil, apperr.New(errcode.RBACAccountInactive, "account is inactive")
	}

	if err := hash.CompareHashAndPassword(userEntity.Password, req.Password); err != nil {
		return nil, apperr.New(errcode.RBACIncorrectPassword, "invalid credentials")
	}

	userRoles, _, _, err := s.doListUserRoles(ctx, &user_role.ListUserRolesRequest{UserId: userEntity.Id})
	if err != nil {
		return nil, err
	}

	var roles []string
	for _, r := range userRoles {
		roles = append(roles, r.Name)
	}

	userEntity.Roles = roles
	userInfo := &jwtx.UserInfo{Name: userEntity.Username, Roles: roles}

	tokenInfo, err := s.JWTAuth.GenerateToken(ctx, userInfo)
	if err != nil {
		return nil, fmt.Errorf("failed to generate token: %w", err)
	}

	logger.CtxInfo(ctx, "User logged in: %s (ID: %d), roles: %s", userEntity.Username, userEntity.Id, roles)

	return appresp.Success(&token.LoginResponse{
		Data: &token.LoginResponseData{
			User: userEntity,
			TokenInfo: &token.TokenInfo{
				AccessToken: tokenInfo.GetAccessToken(),
				TokenType:   tokenInfo.GetTokenType(),
				ExpiresAt:   tokenInfo.GetExpiresAt(),
			},
		},
	}), nil
}

// Logout invalidates the provided token.
func (s *Service) Logout(ctx context.Context, tokenStr string) (*token.LogoutResponse, error) {
	if err := s.JWTAuth.DestroyToken(ctx, tokenStr); err != nil {
		return nil, fmt.Errorf("failed to destroy token: %w", err)
	}

	return appresp.Success(&token.LogoutResponse{}), nil
}

// RefreshToken issues a new JWT token.
func (s *Service) RefreshToken(
	ctx context.Context, oldToken string, userInfo *jwtx.UserInfo,
) (*token.RefreshTokenResponse, error) {
	if err := s.JWTAuth.DestroyToken(ctx, oldToken); err != nil {
		logger.CtxWarn(ctx, "Failed to destroy old token: %v", err)
	}

	tokenInfo, err := s.JWTAuth.GenerateToken(ctx, userInfo)
	if err != nil {
		return nil, fmt.Errorf("failed to generate token: %w", err)
	}

	return appresp.Success(&token.RefreshTokenResponse{
		Data: &token.RefreshTokenResponseData{
			TokenInfo: &token.TokenInfo{
				AccessToken: tokenInfo.GetAccessToken(),
				TokenType:   tokenInfo.GetTokenType(),
				ExpiresAt:   tokenInfo.GetExpiresAt(),
			},
		},
	}), nil
}

// CreateRole creates a role.
func (s *Service) CreateRole(ctx context.Context, req *role.CreateRoleRequest) (*role.CreateRoleResponse, error) {
	if req == nil {
		return nil, apperr.New(errcode.CommonInvalidParam, "request is required")
	}

	id, err := s.doCreateRole(ctx, req)
	if err != nil {
		return nil, err
	}

	return appresp.Success(&role.CreateRoleResponse{
		Data: &role.CreateRoleResponseData{Id: id},
	}), nil
}

// UpdateRole updates a role.
func (s *Service) UpdateRole(ctx context.Context, req *role.UpdateRoleRequest) (*role.UpdateRoleResponse, error) {
	if req == nil {
		return nil, apperr.New(errcode.CommonInvalidParam, "request is required")
	}
	if req.Id <= 0 {
		return nil, apperr.New(errcode.CommonInvalidParam, "id is required")
	}

	if err := s.doUpdateRole(ctx, req); err != nil {
		return nil, err
	}

	return appresp.Success(&role.UpdateRoleResponse{}), nil
}

// DeleteRole deletes a role.
func (s *Service) DeleteRole(ctx context.Context, req *role.DeleteRoleRequest) (*role.DeleteRoleResponse, error) {
	if req == nil {
		return nil, apperr.New(errcode.CommonInvalidParam, "request is required")
	}
	if req.Id <= 0 {
		return nil, apperr.New(errcode.CommonInvalidParam, "id is required")
	}

	if err := s.doDeleteRole(ctx, req.Id); err != nil {
		return nil, err
	}

	return appresp.Success(&role.DeleteRoleResponse{}), nil
}

// GetRole fetches role details.
func (s *Service) GetRole(ctx context.Context, req *role.GetRoleRequest) (*role.GetRoleResponse, error) {
	if req == nil {
		return nil, apperr.New(errcode.CommonInvalidParam, "request is required")
	}
	if req.Id <= 0 {
		return nil, apperr.New(errcode.CommonInvalidParam, "id is required")
	}

	roleObj, err := s.doGetRole(ctx, req.Id)
	if err != nil {
		return nil, err
	}

	return appresp.Success(&role.GetRoleResponse{
		Data: &role.GetRoleResponseData{Role: roleObj},
	}), nil
}

// QueryRoles lists roles.
func (s *Service) QueryRoles(ctx context.Context, req *role.QueryRolesRequest) (*role.QueryRolesResponse, error) {
	if req == nil {
		return nil, apperr.New(errcode.CommonInvalidParam, "request is required")
	}

	roles, total, hasNext, err := s.doQueryRoles(ctx, req)
	if err != nil {
		return nil, err
	}

	return appresp.Success(&role.QueryRolesResponse{
		Data: &role.QueryRolesResponseData{Roles: roles, Total: total, HasNext: hasNext},
	}), nil
}

// AssignUserRole assigns a role to a user.
func (s *Service) AssignUserRole(
	ctx context.Context, req *user_role.AssignUserRoleRequest,
) (*user_role.AssignUserRoleResponse, error) {
	if req == nil {
		return nil, apperr.New(errcode.CommonInvalidParam, "request is required")
	}
	if req.UserId <= 0 || req.RoleId <= 0 {
		return nil, apperr.New(errcode.CommonInvalidParam, "userId and roleId are required")
	}

	if err := s.doAssignUserRole(ctx, req); err != nil {
		return nil, err
	}

	return appresp.Success(&user_role.AssignUserRoleResponse{}), nil
}

// RemoveUserRole removes a role from a user.
func (s *Service) RemoveUserRole(
	ctx context.Context, req *user_role.RemoveUserRoleRequest,
) (*user_role.RemoveUserRoleResponse, error) {
	if req == nil {
		return nil, apperr.New(errcode.CommonInvalidParam, "request is required")
	}
	if req.UserId <= 0 || req.RoleId <= 0 {
		return nil, apperr.New(errcode.CommonInvalidParam, "userId and roleId are required")
	}

	if err := s.doRemoveUserRole(ctx, req); err != nil {
		return nil, err
	}

	return appresp.Success(&user_role.RemoveUserRoleResponse{}), nil
}

// ListUserRoles lists roles assigned to a user.
func (s *Service) ListUserRoles(
	ctx context.Context, req *user_role.ListUserRolesRequest,
) (*user_role.ListUserRolesResponse, error) {
	if req == nil {
		return nil, apperr.New(errcode.CommonInvalidParam, "request is required")
	}
	if req.UserId <= 0 {
		return nil, apperr.New(errcode.CommonInvalidParam, "userId is required")
	}

	roles, total, hasNext, err := s.doListUserRoles(ctx, req)
	if err != nil {
		return nil, err
	}

	return appresp.Success(&user_role.ListUserRolesResponse{
		Data: &user_role.ListUserRolesResponseData{Roles: roles, Total: total, HasNext: hasNext},
	}), nil
}

// ListUsersByRole lists users under a role.
func (s *Service) ListUsersByRole(
	ctx context.Context, req *user_role.ListUsersByRoleRequest,
) (*user_role.ListUsersByRoleResponse, error) {
	if req == nil {
		return nil, apperr.New(errcode.CommonInvalidParam, "request is required")
	}
	if req.RoleId <= 0 {
		return nil, apperr.New(errcode.CommonInvalidParam, "roleId is required")
	}

	users, total, hasNext, err := s.doListUsersByRole(ctx, req)
	if err != nil {
		return nil, err
	}

	return appresp.Success(&user_role.ListUsersByRoleResponse{
		Data: &user_role.ListUsersByRoleResponseData{Users: users, Total: total, HasNext: hasNext},
	}), nil
}

// CreatePolicy creates a Casbin policy.
func (s *Service) CreatePolicy(
	ctx context.Context, req *casbin_rule.CreatePolicyRequest,
) (*casbin_rule.CreatePolicyResponse, error) {
	if req == nil {
		return nil, apperr.New(errcode.CommonInvalidParam, "request is required")
	}

	id, err := s.doCreatePolicy(ctx, req)
	if err != nil {
		return nil, err
	}

	return appresp.Success(&casbin_rule.CreatePolicyResponse{
		Data: &casbin_rule.CreatePolicyResponseData{Id: id},
	}), nil
}

// UpdatePolicy updates a Casbin policy.
func (s *Service) UpdatePolicy(
	ctx context.Context, req *casbin_rule.UpdatePolicyRequest,
) (*casbin_rule.UpdatePolicyResponse, error) {
	if req == nil {
		return nil, apperr.New(errcode.CommonInvalidParam, "request is required")
	}
	if req.Id <= 0 {
		return nil, apperr.New(errcode.CommonInvalidParam, "id is required")
	}

	if err := s.doUpdatePolicy(ctx, req); err != nil {
		return nil, err
	}

	return appresp.Success(&casbin_rule.UpdatePolicyResponse{}), nil
}

// DeletePolicy deletes a Casbin policy.
func (s *Service) DeletePolicy(
	ctx context.Context, req *casbin_rule.DeletePolicyRequest,
) (*casbin_rule.DeletePolicyResponse, error) {
	if req == nil {
		return nil, apperr.New(errcode.CommonInvalidParam, "request is required")
	}
	if req.Id <= 0 {
		return nil, apperr.New(errcode.CommonInvalidParam, "id is required")
	}

	if err := s.doDeletePolicy(ctx, req.Id); err != nil {
		return nil, err
	}

	return appresp.Success(&casbin_rule.DeletePolicyResponse{}), nil
}

// GetPolicy retrieves a policy.
func (s *Service) GetPolicy(ctx context.Context, req *casbin_rule.GetPolicyRequest) (*casbin_rule.GetPolicyResponse, error) {
	if req == nil {
		return nil, apperr.New(errcode.CommonInvalidParam, "request is required")
	}
	if req.Id <= 0 {
		return nil, apperr.New(errcode.CommonInvalidParam, "id is required")
	}

	policyObj, err := s.doGetPolicy(ctx, req.Id)
	if err != nil {
		return nil, err
	}

	return appresp.Success(&casbin_rule.GetPolicyResponse{
		Data: &casbin_rule.GetPolicyResponseData{Policy: policyObj},
	}), nil
}

// QueryPolicies lists policies.
func (s *Service) QueryPolicies(
	ctx context.Context, req *casbin_rule.QueryPoliciesRequest,
) (*casbin_rule.QueryPoliciesResponse, error) {
	if req == nil {
		return nil, apperr.New(errcode.CommonInvalidParam, "request is required")
	}

	policies, total, hasNext, err := s.doQueryPolicies(ctx, req)
	if err != nil {
		return nil, err
	}

	return appresp.Success(&casbin_rule.QueryPoliciesResponse{
		Data: &casbin_rule.QueryPoliciesResponseData{Policies: policies, Total: total, HasNext: hasNext},
	}), nil
}

func (s *Service) doCreateUser(ctx context.Context, req *user.CreateUserRequest) (int64, error) {
	existingUser, err := s.UserRepo.GetUserByUsername(ctx, req.Username)
	if err == nil && existingUser != nil {
		return 0, apperr.New(errcode.RBACUsernameAlreadyExists, "username already exists")
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, err
	}

	existingUser, err = s.UserRepo.GetUserByEmail(ctx, req.Email)
	if err == nil && existingUser != nil {
		return 0, apperr.New(errcode.RBACEmailAlreadyExists, "email already exists")
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, err
	}

	hashedPassword, err := hash.GeneratePassword(req.Password)
	if err != nil {
		logger.CtxError(ctx, "failed to generate password hash: username=%s, err=%v", req.Username, err)
		return 0, err
	}

	req.Password = hashedPassword
	u := &rolerepo.UserModel{
		Username:    req.Username,
		Email:       req.Email,
		Tenant:      req.Tenant,
		Password:    hashedPassword,
		Alias_:      req.Alias,
		Phone:       req.Phone,
		IconURI:     req.IconUri,
		Description: req.Description,
		Status:      int32(rbacCommon.UserStatus_USER_STATUS_ACTIVE),
	}

	if err := s.UserRepo.CreateUser(ctx, u); err != nil {
		logger.CtxError(ctx, "failed to create user: username=%s, err=%v", req.Username, err)
		return 0, err
	}

	return u.ID, nil
}

func (s *Service) doUpdateUser(ctx context.Context, req *user.UpdateUserRequest) error {
	existingUser, err := s.UserRepo.GetUserByID(ctx, req.GetId())
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return apperr.New(errcode.CommonNotFound, "user not found")
		}
		return err
	}

	if err := s.validateUpdateUserEmail(ctx, req, existingUser); err != nil {
		return err
	}

	applyUpdateUserFields(existingUser, req)

	return s.UserRepo.UpdateUser(ctx, existingUser)
}

// validateUpdateUserEmail ensures a new email is not already taken by another user.
func (s *Service) validateUpdateUserEmail(
	ctx context.Context,
	req *user.UpdateUserRequest,
	existingUser *rolerepo.UserModel,
) error {
	if req.Email == "" || req.Email == existingUser.Email {
		return nil
	}

	emailUser, err := s.UserRepo.GetUserByEmail(ctx, req.Email)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}

	if emailUser != nil && emailUser.ID != req.GetId() {
		return apperr.New(errcode.RBACEmailAlreadyExists, "email already exists")
	}

	return nil
}

// applyUpdateUserFields copies non-empty fields from req onto existingUser.
func applyUpdateUserFields(existingUser *rolerepo.UserModel, req *user.UpdateUserRequest) {
	if req.Alias != "" {
		existingUser.Alias_ = req.Alias
	}
	if req.Email != "" {
		existingUser.Email = req.Email
	}
	if req.Phone != "" {
		existingUser.Phone = req.Phone
	}
	if req.IconUri != "" {
		existingUser.IconURI = req.IconUri
	}
	if req.Description != "" {
		existingUser.Description = req.Description
	}
	if req.Status >= 0 {
		existingUser.Status = int32(req.Status)
	}
	if req.Tenant != "" {
		existingUser.Tenant = req.Tenant
	}
}

func (s *Service) doDeleteUser(ctx context.Context, id int64) error {
	if _, err := s.UserRepo.GetUserByID(ctx, id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return apperr.New(errcode.CommonNotFound, "user not found")
		}
		return err
	}

	if s.Enforcer != nil {
		userModel, _ := s.UserRepo.GetUserByID(ctx, id)
		if userModel != nil {
			_ = s.Enforcer.LoadPolicy()
			groupingPolicies, _ := s.Enforcer.GetGroupingPolicy()
			for _, gp := range groupingPolicies {
				if len(gp) >= 2 && gp[0] == userModel.Username {
					_, _ = s.Enforcer.RemoveGroupingPolicy(gp[0], gp[1])
				}
			}
		}
	}
	return s.UserRepo.DeleteUser(ctx, id)
}

func (s *Service) doGetUserByEmail(ctx context.Context, email string) (*entity.User, error) {
	userModel, err := s.UserRepo.GetUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperr.Wrap(errcode.CommonNotFound, "user not found", err)
		}
		logger.CtxError(ctx, "failed to get user by email: email=%s, err=%v", email, err)
		return nil, err
	}

	return userPo2Do(userModel), nil
}

func (s *Service) doGetUser(ctx context.Context, username string) (*entity.User, error) {
	userModel, err := s.UserRepo.GetUserByUsername(ctx, username)
	if err != nil {
		logger.CtxError(ctx, "failed to get user by username: username=%s, err=%v", username, err)
		return nil, err
	}

	return userPo2Do(userModel), nil
}

func (s *Service) doQueryUsers(ctx context.Context, req *user.QueryUsersRequest) ([]*entity.User, int32, bool, error) {
	page := req.Page
	if page == 0 {
		page = 1
	}
	pageSize := req.PageSize
	if pageSize == 0 {
		pageSize = 10
	}

	var statusList []int32
	for _, status := range req.StatusArr {
		statusList = append(statusList, int32(status))
	}

	filter := &entity.UserFilter{
		Alias:      req.Alias,
		Email:      req.Email,
		Phone:      req.Phone,
		StatusList: statusList,
	}

	userModels, totalCount, err := s.UserRepo.QueryUsers(ctx, filter, page, pageSize)
	if err != nil {
		logger.CtxError(ctx, "failed to query users: err=%v", err)
		return nil, 0, false, err
	}

	users := slicesx.Transform(userModels, func(um *rolerepo.UserModel) *entity.User {
		return userPo2Do(um)
	})

	hasNext := int64(page*pageSize) < totalCount
	return users, int32(totalCount), hasNext, nil
}

func (s *Service) doCreateRole(ctx context.Context, req *role.CreateRoleRequest) (int64, error) {
	if existing, err := s.RoleRepo.GetRoleByCode(ctx, req.Code); err == nil {
		if existing != nil {
			return 0, apperr.New(errcode.RBACRoleCodeAlreadyExists, "role code already exists")
		}
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, err
	}

	po := &rolerepo.RoleModel{Code: req.Code, Name: req.Name, Description: req.Description, Status: 1}
	if err := s.RoleRepo.CreateRole(ctx, po); err != nil {
		logger.CtxError(ctx, "failed to create role: code=%s, name=%s, err=%v", req.Code, req.Name, err)
		return 0, err
	}

	return po.ID, nil
}

func (s *Service) doUpdateRole(ctx context.Context, req *role.UpdateRoleRequest) error {
	po, err := s.RoleRepo.GetRole(ctx, req.Id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return apperr.New(errcode.CommonNotFound, "role not found")
		}
		return err
	}

	if req.Name != "" {
		po.Name = req.Name
	}
	if req.Description != "" {
		po.Description = req.Description
	}
	if req.Status == 0 || req.Status == 1 {
		po.Status = req.Status
	}

	return s.RoleRepo.UpdateRole(ctx, po)
}

func (s *Service) doDeleteRole(ctx context.Context, id int64) error {
	if _, err := s.RoleRepo.GetRole(ctx, id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return apperr.New(errcode.CommonNotFound, "role not found")
		}
		return err
	}

	if err := s.syncEnforcerAfterRoleDelete(ctx, id); err != nil {
		return err
	}

	return s.RoleRepo.DeleteRole(ctx, id)
}

// syncEnforcerAfterRoleDelete removes any grouping policies referencing the role being
// deleted so Casbin state stays consistent with the database.
func (s *Service) syncEnforcerAfterRoleDelete(ctx context.Context, id int64) error {
	if s.Enforcer == nil {
		return nil
	}
	if err := s.Enforcer.LoadPolicy(); err != nil {
		return err
	}

	gps, _ := s.Enforcer.GetGroupingPolicy()
	roleModel, _ := s.RoleRepo.GetRole(ctx, id)
	if roleModel == nil {
		return nil
	}

	for _, gp := range gps {
		if len(gp) >= 2 && gp[1] == roleModel.Code {
			if _, err := s.Enforcer.RemoveGroupingPolicy(gp[0], gp[1]); err != nil {
				return err
			}
		}
	}

	return nil
}

func (s *Service) doGetRole(ctx context.Context, id int64) (*role.Role, error) {
	po, err := s.RoleRepo.GetRole(ctx, id)
	if err != nil {
		logger.CtxError(ctx, "failed to get role: id=%d, err=%v", id, err)
		return nil, err
	}

	return rolePo2Pb(po), nil
}

func (s *Service) doQueryRoles(ctx context.Context, req *role.QueryRolesRequest) ([]*role.Role, int32, bool, error) {
	var statusPtr *int32
	if req.Status == 0 || req.Status == 1 {
		status := req.Status
		statusPtr = &status
	}

	list, total, err := s.RoleRepo.QueryRoles(ctx, req.Code, req.Name, statusPtr, req.Page, req.PageSize)
	if err != nil {
		logger.CtxError(ctx, "failed to query roles: err=%v", err)
		return nil, 0, false, err
	}

	roles := slicesx.Transform(list, func(po *rolerepo.RoleModel) *role.Role { return rolePo2Pb(po) })
	hasNext := int64(req.Page*req.PageSize) < total
	return roles, int32(total), hasNext, nil
}

func (s *Service) doAssignUserRole(ctx context.Context, req *user_role.AssignUserRoleRequest) error {
	userModel, err := s.UserRepo.GetUserByID(ctx, req.UserId)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return apperr.New(errcode.CommonNotFound, "user not found")
		}
		return err
	}

	roleModel, err := s.RoleRepo.GetRole(ctx, req.RoleId)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return apperr.New(errcode.CommonNotFound, "role not found")
		}
		return err
	}

	roles, _, err := s.UserRoleRepo.ListRolesByUser(ctx, req.UserId, 1, 1000)
	if err != nil {
		return err
	}
	for _, existing := range roles {
		if existing.ID == req.RoleId {
			return apperr.New(errcode.RBACRoleAlreadyAssigned, "role already assigned to user")
		}
	}

	if err := s.UserRoleRepo.Assign(ctx, &rolerepo.UserRoleModel{UserID: req.UserId, RoleID: req.RoleId}); err != nil {
		return err
	}

	if s.Enforcer != nil {
		if userModel != nil && roleModel != nil {
			if added, _ := s.Enforcer.AddGroupingPolicy(userModel.Username, roleModel.Code); added {
				logger.CtxInfo(ctx, "grouping added: %s -> %s", userModel.Username, roleModel.Code)
			}
		}
	}

	return nil
}

func (s *Service) doRemoveUserRole(ctx context.Context, req *user_role.RemoveUserRoleRequest) error {
	if err := s.UserRoleRepo.Remove(ctx, req.UserId, req.RoleId); err != nil {
		return err
	}

	if s.Enforcer != nil {
		userModel, _ := s.UserRepo.GetUserByID(ctx, req.UserId)
		roleModel, _ := s.RoleRepo.GetRole(ctx, req.RoleId)
		if userModel != nil && roleModel != nil {
			if removed, _ := s.Enforcer.RemoveGroupingPolicy(userModel.Username, roleModel.Code); removed {
				logger.CtxInfo(ctx, "grouping removed: %s -> %s", userModel.Username, roleModel.Code)
			}
		}
	}

	return nil
}

func (s *Service) doListUserRoles(ctx context.Context, req *user_role.ListUserRolesRequest) ([]*role.Role, int32, bool, error) {
	list, total, err := s.UserRoleRepo.ListRolesByUser(ctx, req.UserId, req.Page, req.PageSize)
	if err != nil {
		logger.CtxError(ctx, "failed to list user roles: userId=%d, err=%v", req.UserId, err)
		return nil, 0, false, err
	}

	roles := slicesx.Transform(list, func(po *rolerepo.RoleModel) *role.Role { return rolePo2Pb(po) })
	hasNext := int64(req.Page*req.PageSize) < total
	return roles, int32(total), hasNext, nil
}

func (s *Service) doListUsersByRole(
	ctx context.Context, req *user_role.ListUsersByRoleRequest,
) ([]*entity.User, int32, bool, error) {
	list, total, err := s.UserRoleRepo.ListUsersByRole(ctx, req.RoleId, req.Page, req.PageSize)
	if err != nil {
		logger.CtxError(ctx, "failed to list users by role: roleId=%d, err=%v", req.RoleId, err)
		return nil, 0, false, err
	}

	users := slicesx.Transform(list, func(po *rolerepo.UserModel) *entity.User { return userPo2Do(po) })
	hasNext := int64(req.Page*req.PageSize) < total
	return users, int32(total), hasNext, nil
}

func (s *Service) doCreatePolicy(ctx context.Context, req *casbin_rule.CreatePolicyRequest) (int64, error) {
	if s.Enforcer == nil {
		return 0, apperr.New(errcode.RBACCasbinNotInitialized, "casbin enforcer not initialized")
	}

	rule := policyRuleFromCreate(req)
	params := policyRuleParams(rule)
	ptype := req.Ptype
	if ptype == "" {
		ptype = "p"
	}

	added, err := s.Enforcer.AddNamedPolicy(ptype, params...)
	if err != nil {
		logger.CtxError(ctx, "failed to add named policy: ptype=%s, err=%v", ptype, err)
		return 0, err
	}
	if !added {
		return 0, apperr.New(errcode.RBACPolicyAlreadyExists, "policy already exists")
	}

	po, err := s.CasbinRepo.GetByRule(ctx, ptype, rule)
	if err != nil {
		logger.CtxError(ctx, "failed to get policy by rule: ptype=%s, err=%v", ptype, err)
		return 0, err
	}

	logger.CtxInfo(ctx, "policy added: %s %s %s", rule[0], rule[1], rule[2])
	return po.ID, nil
}

func (s *Service) doUpdatePolicy(ctx context.Context, req *casbin_rule.UpdatePolicyRequest) error {
	po, err := s.CasbinRepo.Get(ctx, req.Id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return apperr.New(errcode.CommonNotFound, "policy not found")
		}
		return err
	}
	if s.Enforcer == nil {
		return apperr.New(errcode.RBACCasbinNotInitialized, "casbin enforcer not initialized")
	}

	oldRule := policyRuleFromModel(po)

	if req.V0 != "" {
		po.V0 = req.V0
	}
	if req.V1 != "" {
		po.V1 = req.V1
	}
	if req.V2 != "" {
		po.V2 = req.V2
	}
	if req.V3 != "" {
		po.V3 = req.V3
	}
	if req.V4 != "" {
		po.V4 = req.V4
	}
	if req.V5 != "" {
		po.V5 = req.V5
	}

	newRule := policyRuleFromModel(po)
	if equalPolicyRules(oldRule, newRule) {
		return nil
	}

	trimmedOld := trimPolicyRule(oldRule)
	trimmedNew := trimPolicyRule(newRule)
	updated, err := s.Enforcer.UpdateNamedPolicy(po.Ptype, trimmedOld, trimmedNew)
	if err != nil {
		logger.CtxError(ctx, "failed to update named policy: ptype=%s, id=%d, err=%v", po.Ptype, req.Id, err)
		return apperr.Wrap(errcode.RBACPolicyUpdateFailed, "failed to update policy", err)
	}
	if !updated {
		return apperr.New(errcode.RBACPolicyUpdateFailed, "policy update failed")
	}

	logger.CtxInfo(ctx, "policy updated: %s %s %s", trimmedNew[0], trimmedNew[1], trimmedNew[2])
	return nil
}

func (s *Service) doDeletePolicy(ctx context.Context, id int64) error {
	po, err := s.CasbinRepo.Get(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return apperr.New(errcode.CommonNotFound, "policy not found")
		}
		return err
	}
	if s.Enforcer == nil {
		return apperr.New(errcode.RBACCasbinNotInitialized, "casbin enforcer not initialized")
	}

	rule := policyRuleFromModel(po)
	removed, err := s.Enforcer.RemoveNamedPolicy(po.Ptype, policyRuleParams(rule)...)
	if err != nil {
		logger.CtxError(ctx, "failed to remove named policy: ptype=%s, id=%d, err=%v", po.Ptype, id, err)
		return err
	}
	if !removed {
		return apperr.New(errcode.CommonNotFound, "policy not found")
	}

	logger.CtxInfo(ctx, "policy removed: %s %s %s", rule[0], rule[1], rule[2])
	return nil
}

func (s *Service) doGetPolicy(ctx context.Context, id int64) (*casbin_rule.CasbinRule, error) {
	po, err := s.CasbinRepo.Get(ctx, id)
	if err != nil {
		logger.CtxError(ctx, "failed to get policy: id=%d, err=%v", id, err)
		return nil, err
	}

	return casbinRulePo2Pb(po), nil
}

func (s *Service) doQueryPolicies(
	ctx context.Context, req *casbin_rule.QueryPoliciesRequest,
) ([]*casbin_rule.CasbinRule, int32, bool, error) {
	list, total, err := s.CasbinRepo.Query(ctx, req.Ptype, req.V0, req.V1, req.V2, req.Page, req.PageSize)
	if err != nil {
		logger.CtxError(ctx, "failed to query policies: ptype=%s, err=%v", req.Ptype, err)
		return nil, 0, false, err
	}

	policies := slicesx.Transform(list, func(po *rolerepo.PolicyModel) *casbin_rule.CasbinRule { return casbinRulePo2Pb(po) })
	hasNext := int64(req.Page*req.PageSize) < total

	return policies, int32(total), hasNext, nil
}

func (s *Service) doUpdatePassword(ctx context.Context, userID int64, oldPassword, newPassword string) error {
	userModel, err := s.UserRepo.GetUserByID(ctx, userID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return apperr.New(errcode.CommonNotFound, "user not found")
		}
		return err
	}

	if err := hash.CompareHashAndPassword(userModel.Password, oldPassword); err != nil {
		return apperr.New(errcode.RBACIncorrectOldPassword, "incorrect old password")
	}

	hashedPassword, err := hash.GeneratePassword(newPassword)
	if err != nil {
		logger.CtxError(ctx, "failed to generate new password hash: userId=%d, err=%v", userID, err)
		return err
	}

	return s.UserRepo.UpdatePassword(ctx, userID, hashedPassword)
}

const policyFieldCount = 6

func policyRuleFromCreate(req *casbin_rule.CreatePolicyRequest) []string {
	return normalizePolicyRule([]string{req.V0, req.V1, req.V2, req.V3, req.V4, req.V5})
}

func policyRuleFromModel(po *rolerepo.PolicyModel) []string {
	if po == nil {
		return normalizePolicyRule(nil)
	}

	return normalizePolicyRule([]string{po.V0, po.V1, po.V2, po.V3, po.V4, po.V5})
}

func normalizePolicyRule(rule []string) []string {
	normalized := make([]string, policyFieldCount)
	copy(normalized, rule)
	return normalized
}

func policyRuleParams(rule []string) []interface{} {
	normalized := normalizePolicyRule(rule)
	length := policyFieldCount
	for length > 3 && normalized[length-1] == "" {
		length--
	}

	params := make([]interface{}, length)
	for i := 0; i < length; i++ {
		params[i] = normalized[i]
	}

	return params
}

func trimPolicyRule(rule []string) []string {
	normalized := normalizePolicyRule(rule)
	length := policyFieldCount
	for length > 0 && normalized[length-1] == "" {
		length--
	}
	return normalized[:length]
}

func equalPolicyRules(a, b []string) bool {
	aNorm := normalizePolicyRule(a)
	bNorm := normalizePolicyRule(b)
	for i := 0; i < policyFieldCount; i++ {
		if aNorm[i] != bNorm[i] {
			return false
		}
	}
	return true
}

func rolePo2Pb(po *rolerepo.RoleModel) *role.Role {
	return &role.Role{
		Id:          po.ID,
		Code:        po.Code,
		Name:        po.Name,
		Description: po.Description,
		Status:      po.Status,
		CreatedAt:   po.CreatedAt / 1000,
		UpdatedAt:   po.UpdatedAt / 1000,
	}
}

func casbinRulePo2Pb(po *rolerepo.PolicyModel) *casbin_rule.CasbinRule {
	return &casbin_rule.CasbinRule{
		Id:    po.ID,
		Ptype: po.Ptype,
		V0:    po.V0,
		V1:    po.V1,
		V2:    po.V2,
		V3:    po.V3,
		V4:    po.V4,
		V5:    po.V5,
	}
}

func userPo2Do(modelUser *rolerepo.UserModel) *entity.User {
	return &entity.User{
		Id:          modelUser.ID,
		Alias:       modelUser.Alias_,
		Username:    modelUser.Username,
		Email:       modelUser.Email,
		Tenant:      modelUser.Tenant,
		Phone:       modelUser.Phone,
		IconUri:     modelUser.IconURI,
		RawIconUri:  modelUser.IconURI,
		Password:    modelUser.Password,
		Status:      rbacCommon.UserStatus(modelUser.Status),
		Description: modelUser.Description,
		CreatedAt:   modelUser.CreatedAt / 1000,
		UpdatedAt:   modelUser.UpdatedAt / 1000,
	}
}
