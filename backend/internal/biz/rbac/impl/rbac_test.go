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
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/errcode"
	rolerepo "sico-backend/internal/store/rbac/repository"
	rbacCommon "sico-backend/internal/transport/http/dto/rbac/common"
	"sico-backend/internal/transport/http/dto/rbac/role"
	"sico-backend/internal/transport/http/dto/rbac/token"
	"sico-backend/internal/transport/http/dto/rbac/user"
	"sico-backend/internal/transport/http/dto/rbac/user_role"
	"sico-backend/pkg/crypto/hash"
	"sico-backend/pkg/jwtx"

	entity "sico-backend/internal/entity/rbac"
)

// ─── mocks ──────────────────────────────────────────────────────────────────────

type mockUserRepo struct{ mock.Mock }

func (m *mockUserRepo) CreateUser(ctx context.Context, u *rolerepo.UserModel) error {
	args := m.Called(ctx, u)
	if u != nil && args.Error(0) == nil {
		u.ID = 1 // simulate auto-increment
	}
	return args.Error(0)
}
func (m *mockUserRepo) UpdateUser(ctx context.Context, u *rolerepo.UserModel) error {
	return m.Called(ctx, u).Error(0)
}
func (m *mockUserRepo) UpdateUserFields(ctx context.Context, id int64, fields map[string]interface{}) error {
	return m.Called(ctx, id, fields).Error(0)
}
func (m *mockUserRepo) DeleteUser(ctx context.Context, id int64) error {
	return m.Called(ctx, id).Error(0)
}
func (m *mockUserRepo) GetUserByID(ctx context.Context, id int64) (*rolerepo.UserModel, error) {
	args := m.Called(ctx, id)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*rolerepo.UserModel), args.Error(1)
}
func (m *mockUserRepo) GetUserByUsername(ctx context.Context, username string) (*rolerepo.UserModel, error) {
	args := m.Called(ctx, username)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*rolerepo.UserModel), args.Error(1)
}
func (m *mockUserRepo) GetUserByEmail(ctx context.Context, email string) (*rolerepo.UserModel, error) {
	args := m.Called(ctx, email)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*rolerepo.UserModel), args.Error(1)
}
func (m *mockUserRepo) QueryUsers(
	ctx context.Context, filter *entity.UserFilter, page, pageSize int32,
) ([]*rolerepo.UserModel, int64, error) {
	args := m.Called(ctx, filter, page, pageSize)
	if args.Get(0) == nil {
		return nil, 0, args.Error(2)
	}
	return args.Get(0).([]*rolerepo.UserModel), args.Get(1).(int64), args.Error(2)
}
func (m *mockUserRepo) UpdatePassword(ctx context.Context, id int64, pw string) error {
	return m.Called(ctx, id, pw).Error(0)
}

type mockRoleRepo struct{ mock.Mock }

func (m *mockRoleRepo) CreateRole(ctx context.Context, r *rolerepo.RoleModel) error {
	args := m.Called(ctx, r)
	if r != nil && args.Error(0) == nil {
		r.ID = 10
	}
	return args.Error(0)
}
func (m *mockRoleRepo) UpdateRole(ctx context.Context, r *rolerepo.RoleModel) error {
	return m.Called(ctx, r).Error(0)
}
func (m *mockRoleRepo) DeleteRole(ctx context.Context, id int64) error {
	return m.Called(ctx, id).Error(0)
}
func (m *mockRoleRepo) GetRole(ctx context.Context, id int64) (*rolerepo.RoleModel, error) {
	args := m.Called(ctx, id)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*rolerepo.RoleModel), args.Error(1)
}
func (m *mockRoleRepo) GetRoleByCode(ctx context.Context, code string) (*rolerepo.RoleModel, error) {
	args := m.Called(ctx, code)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*rolerepo.RoleModel), args.Error(1)
}
func (m *mockRoleRepo) QueryRoles(
	ctx context.Context, code, name string, status *int32, page, pageSize int32,
) ([]*rolerepo.RoleModel, int64, error) {
	args := m.Called(ctx, code, name, status, page, pageSize)
	if args.Get(0) == nil {
		return nil, 0, args.Error(2)
	}
	return args.Get(0).([]*rolerepo.RoleModel), args.Get(1).(int64), args.Error(2)
}

type mockUserRoleRepo struct{ mock.Mock }

func (m *mockUserRoleRepo) Assign(ctx context.Context, ur *rolerepo.UserRoleModel) error {
	return m.Called(ctx, ur).Error(0)
}
func (m *mockUserRoleRepo) Remove(ctx context.Context, userID, roleID int64) error {
	return m.Called(ctx, userID, roleID).Error(0)
}
func (m *mockUserRoleRepo) ListRolesByUser(
	ctx context.Context, userID int64, page, pageSize int32,
) ([]*rolerepo.RoleModel, int64, error) {
	args := m.Called(ctx, userID, page, pageSize)
	if args.Get(0) == nil {
		return nil, 0, args.Error(2)
	}
	return args.Get(0).([]*rolerepo.RoleModel), args.Get(1).(int64), args.Error(2)
}
func (m *mockUserRoleRepo) ListUsersByRole(
	ctx context.Context, roleID int64, page, pageSize int32,
) ([]*rolerepo.UserModel, int64, error) {
	args := m.Called(ctx, roleID, page, pageSize)
	if args.Get(0) == nil {
		return nil, 0, args.Error(2)
	}
	return args.Get(0).([]*rolerepo.UserModel), args.Get(1).(int64), args.Error(2)
}

type mockCasbinRepo struct{ mock.Mock }

func (m *mockCasbinRepo) Create(ctx context.Context, rule *rolerepo.PolicyModel) error {
	return m.Called(ctx, rule).Error(0)
}
func (m *mockCasbinRepo) Update(ctx context.Context, rule *rolerepo.PolicyModel) error {
	return m.Called(ctx, rule).Error(0)
}
func (m *mockCasbinRepo) Delete(ctx context.Context, id int64) error {
	return m.Called(ctx, id).Error(0)
}
func (m *mockCasbinRepo) Get(ctx context.Context, id int64) (*rolerepo.PolicyModel, error) {
	args := m.Called(ctx, id)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*rolerepo.PolicyModel), args.Error(1)
}
func (m *mockCasbinRepo) GetByRule(ctx context.Context, ptype string, rule []string) (*rolerepo.PolicyModel, error) {
	args := m.Called(ctx, ptype, rule)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*rolerepo.PolicyModel), args.Error(1)
}
func (m *mockCasbinRepo) Query(
	ctx context.Context, ptype, v0, v1, v2 string, page, pageSize int32,
) ([]*rolerepo.PolicyModel, int64, error) {
	args := m.Called(ctx, ptype, v0, v1, v2, page, pageSize)
	if args.Get(0) == nil {
		return nil, 0, args.Error(2)
	}
	return args.Get(0).([]*rolerepo.PolicyModel), args.Get(1).(int64), args.Error(2)
}

type mockAuther struct{ mock.Mock }

func (m *mockAuther) GenerateToken(ctx context.Context, info *jwtx.UserInfo) (jwtx.TokenInfo, error) {
	args := m.Called(ctx, info)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(jwtx.TokenInfo), args.Error(1)
}
func (m *mockAuther) DestroyToken(ctx context.Context, token string) error {
	return m.Called(ctx, token).Error(0)
}
func (m *mockAuther) ParseSubject(ctx context.Context, token string) (*jwtx.UserInfo, error) {
	args := m.Called(ctx, token)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*jwtx.UserInfo), args.Error(1)
}
func (m *mockAuther) Release(ctx context.Context) error { return nil }

type stubTokenInfo struct {
	accessToken string
	tokenType   string
	expiresAt   int64
}

func (s *stubTokenInfo) GetAccessToken() string          { return s.accessToken }
func (s *stubTokenInfo) GetTokenType() string            { return s.tokenType }
func (s *stubTokenInfo) GetExpiresAt() int64             { return s.expiresAt }
func (s *stubTokenInfo) EncodeToJSON() ([]byte, error)   { return nil, nil }

// ─── helpers ────────────────────────────────────────────────────────────────────

func newTestService() (*Service, *mockUserRepo, *mockRoleRepo, *mockUserRoleRepo, *mockCasbinRepo, *mockAuther) {
	ur := new(mockUserRepo)
	rr := new(mockRoleRepo)
	urr := new(mockUserRoleRepo)
	cr := new(mockCasbinRepo)
	auth := new(mockAuther)

	svc := NewService(&Components{
		UserRepo:     ur,
		RoleRepo:     rr,
		UserRoleRepo: urr,
		CasbinRepo:   cr,
	}, auth)

	return svc, ur, rr, urr, cr, auth
}

func hashedPassword(pw string) string {
	h, _ := hash.GeneratePassword(pw)
	return h
}

// ─── CreateUser ─────────────────────────────────────────────────────────────────

func TestCreateUser(t *testing.T) {
	tests := []struct {
		name    string
		req     *user.CreateUserRequest
		setup   func(*mockUserRepo)
		wantErr bool
		errCode int32
	}{
		{
			name:    "nil request",
			req:     nil,
			wantErr: true,
			errCode: errcode.CommonInvalidParam,
		},
		{
			name: "username already exists",
			req:  &user.CreateUserRequest{Username: "alice", Email: "a@b.com", Password: "pass123"},
			setup: func(ur *mockUserRepo) {
				ur.On("GetUserByUsername", mock.Anything, "alice").
					Return(&rolerepo.UserModel{ID: 1, Username: "alice"}, nil)
			},
			wantErr: true,
			errCode: errcode.RBACUsernameAlreadyExists,
		},
		{
			name: "email already exists",
			req:  &user.CreateUserRequest{Username: "bob", Email: "a@b.com", Password: "pass123"},
			setup: func(ur *mockUserRepo) {
				ur.On("GetUserByUsername", mock.Anything, "bob").
					Return(nil, gorm.ErrRecordNotFound)
				ur.On("GetUserByEmail", mock.Anything, "a@b.com").
					Return(&rolerepo.UserModel{ID: 2, Email: "a@b.com"}, nil)
			},
			wantErr: true,
			errCode: errcode.RBACEmailAlreadyExists,
		},
		{
			name: "success",
			req: &user.CreateUserRequest{
				Username: "charlie", Email: "c@d.com", Password: "pass123", Alias: "Charlie",
			},
			setup: func(ur *mockUserRepo) {
				ur.On("GetUserByUsername", mock.Anything, "charlie").
					Return(nil, gorm.ErrRecordNotFound)
				ur.On("GetUserByEmail", mock.Anything, "c@d.com").
					Return(nil, gorm.ErrRecordNotFound)
				ur.On("CreateUser", mock.Anything, mock.MatchedBy(func(u *rolerepo.UserModel) bool {
					return u.Username == "charlie" && u.Email == "c@d.com" &&
						u.Status == int32(rbacCommon.UserStatus_USER_STATUS_ACTIVE)
				})).Return(nil)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, ur, _, _, _, _ := newTestService()
			if tt.setup != nil {
				tt.setup(ur)
			}

			resp, err := svc.CreateUser(context.Background(), tt.req)
			if tt.wantErr {
				require.Error(t, err)
				if ae, ok := apperr.As(err); ok {
					assert.Equal(t, tt.errCode, ae.Code())
				}
				return
			}

			require.NoError(t, err)
			require.NotNil(t, resp)
			assert.Greater(t, resp.Data.Id, int64(0))
		})
	}
}

// ─── UpdateUser ─────────────────────────────────────────────────────────────────

func TestUpdateUser(t *testing.T) {
	tests := []struct {
		name    string
		req     *user.UpdateUserRequest
		setup   func(*mockUserRepo)
		wantErr bool
		errCode int32
	}{
		{name: "nil request", req: nil, wantErr: true, errCode: errcode.CommonInvalidParam},
		{name: "zero id", req: &user.UpdateUserRequest{Id: 0}, wantErr: true, errCode: errcode.CommonInvalidParam},
		{
			name: "user not found",
			req:  &user.UpdateUserRequest{Id: 99},
			setup: func(ur *mockUserRepo) {
				ur.On("GetUserByID", mock.Anything, int64(99)).Return(nil, gorm.ErrRecordNotFound)
			},
			wantErr: true,
			errCode: errcode.CommonNotFound,
		},
		{
			name: "success - partial update",
			req:  &user.UpdateUserRequest{Id: 1, Alias: "NewName"},
			setup: func(ur *mockUserRepo) {
				ur.On("GetUserByID", mock.Anything, int64(1)).
					Return(&rolerepo.UserModel{ID: 1, Username: "alice", Alias_: "Alice"}, nil)
				ur.On("UpdateUser", mock.Anything, mock.MatchedBy(func(u *rolerepo.UserModel) bool {
					return u.Alias_ == "NewName"
				})).Return(nil)
			},
		},
		{
			name: "email conflict with another user",
			req:  &user.UpdateUserRequest{Id: 1, Email: "taken@b.com"},
			setup: func(ur *mockUserRepo) {
				ur.On("GetUserByID", mock.Anything, int64(1)).
					Return(&rolerepo.UserModel{ID: 1, Email: "old@a.com"}, nil)
				ur.On("GetUserByEmail", mock.Anything, "taken@b.com").
					Return(&rolerepo.UserModel{ID: 2, Email: "taken@b.com"}, nil)
			},
			wantErr: true,
			errCode: errcode.RBACEmailAlreadyExists,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, ur, _, _, _, _ := newTestService()
			if tt.setup != nil {
				tt.setup(ur)
			}

			_, err := svc.UpdateUser(context.Background(), tt.req)
			if tt.wantErr {
				require.Error(t, err)
				if ae, ok := apperr.As(err); ok {
					assert.Equal(t, tt.errCode, ae.Code())
				}
				return
			}
			require.NoError(t, err)
		})
	}
}

// ─── DeleteUser ─────────────────────────────────────────────────────────────────

func TestDeleteUser(t *testing.T) {
	t.Run("nil request", func(t *testing.T) {
		svc, _, _, _, _, _ := newTestService()
		_, err := svc.DeleteUser(context.Background(), nil)
		require.Error(t, err)
	})

	t.Run("user not found", func(t *testing.T) {
		svc, ur, _, _, _, _ := newTestService()
		ur.On("GetUserByID", mock.Anything, int64(99)).Return(nil, gorm.ErrRecordNotFound)
		_, err := svc.DeleteUser(context.Background(), &user.DeleteUserRequest{Id: 99})
		require.Error(t, err)
	})

	t.Run("success", func(t *testing.T) {
		svc, ur, _, _, _, _ := newTestService()
		ur.On("GetUserByID", mock.Anything, int64(1)).Return(&rolerepo.UserModel{ID: 1}, nil)
		ur.On("DeleteUser", mock.Anything, int64(1)).Return(nil)
		resp, err := svc.DeleteUser(context.Background(), &user.DeleteUserRequest{Id: 1})
		require.NoError(t, err)
		require.NotNil(t, resp)
	})
}

// ─── GetUser ────────────────────────────────────────────────────────────────────

func TestGetUser(t *testing.T) {
	t.Run("empty username", func(t *testing.T) {
		svc, _, _, _, _, _ := newTestService()
		_, err := svc.GetUser(context.Background(), &user.GetUserRequest{Username: ""})
		require.Error(t, err)
	})

	t.Run("success with roles", func(t *testing.T) {
		svc, ur, _, urr, _, _ := newTestService()
		ur.On("GetUserByUsername", mock.Anything, "alice").
			Return(&rolerepo.UserModel{ID: 1, Username: "alice", Alias_: "Alice", Email: "a@b.com", Status: 1}, nil)
		urr.On("ListRolesByUser", mock.Anything, int64(1), mock.Anything, mock.Anything).
			Return([]*rolerepo.RoleModel{{ID: 10, Code: "admin"}}, int64(1), nil)

		resp, err := svc.GetUser(context.Background(), &user.GetUserRequest{Username: "alice"})
		require.NoError(t, err)
		assert.Equal(t, "alice", resp.Data.User.Username)
		assert.Contains(t, resp.Data.User.Roles, "admin")
	})
}

// ─── QueryUsers ─────────────────────────────────────────────────────────────────

func TestQueryUsers(t *testing.T) {
	t.Run("success with pagination", func(t *testing.T) {
		svc, ur, _, _, _, _ := newTestService()
		ur.On("QueryUsers", mock.Anything, mock.Anything, int32(1), int32(10)).
			Return([]*rolerepo.UserModel{
				{ID: 1, Username: "alice", Alias_: "Alice"},
				{ID: 2, Username: "bob", Alias_: "Bob"},
			}, int64(5), nil)

		resp, err := svc.QueryUsers(context.Background(), &user.QueryUsersRequest{Page: 1, PageSize: 10})
		require.NoError(t, err)
		assert.Len(t, resp.Data.Users, 2)
		assert.Equal(t, int32(5), resp.Data.Total)
	})

	t.Run("defaults page and pageSize", func(t *testing.T) {
		svc, ur, _, _, _, _ := newTestService()
		ur.On("QueryUsers", mock.Anything, mock.Anything, int32(1), int32(10)).
			Return([]*rolerepo.UserModel{}, int64(0), nil)

		resp, err := svc.QueryUsers(context.Background(), &user.QueryUsersRequest{})
		require.NoError(t, err)
		assert.Empty(t, resp.Data.Users)
	})
}

// ─── Login ──────────────────────────────────────────────────────────────────────

func TestLogin(t *testing.T) {
	pw := hashedPassword("correct-password")

	tests := []struct {
		name    string
		req     *token.LoginRequest
		setup   func(*mockUserRepo, *mockUserRoleRepo, *mockAuther)
		wantErr bool
		errCode int32
	}{
		{
			name:    "nil request",
			req:     nil,
			wantErr: true,
			errCode: errcode.CommonInvalidParam,
		},
		{
			name:    "missing email",
			req:     &token.LoginRequest{Email: "", Password: "pw"},
			wantErr: true,
			errCode: errcode.CommonInvalidParam,
		},
		{
			name: "user not found returns generic error",
			req:  &token.LoginRequest{Email: "x@y.com", Password: "pw"},
			setup: func(ur *mockUserRepo, _ *mockUserRoleRepo, _ *mockAuther) {
				ur.On("GetUserByEmail", mock.Anything, "x@y.com").Return(nil, gorm.ErrRecordNotFound)
			},
			wantErr: true,
			errCode: errcode.RBACIncorrectPassword,
		},
		{
			name: "inactive account",
			req:  &token.LoginRequest{Email: "a@b.com", Password: "correct-password"},
			setup: func(ur *mockUserRepo, _ *mockUserRoleRepo, _ *mockAuther) {
				ur.On("GetUserByEmail", mock.Anything, "a@b.com").
					Return(&rolerepo.UserModel{
						ID: 1, Email: "a@b.com", Password: pw,
						Status: int32(rbacCommon.UserStatus_USER_STATUS_INACTIVE),
					}, nil)
			},
			wantErr: true,
			errCode: errcode.RBACAccountInactive,
		},
		{
			name: "wrong password",
			req:  &token.LoginRequest{Email: "a@b.com", Password: "wrong"},
			setup: func(ur *mockUserRepo, _ *mockUserRoleRepo, _ *mockAuther) {
				ur.On("GetUserByEmail", mock.Anything, "a@b.com").
					Return(&rolerepo.UserModel{ID: 1, Email: "a@b.com", Password: pw, Status: 1}, nil)
			},
			wantErr: true,
			errCode: errcode.RBACIncorrectPassword,
		},
		{
			name: "success",
			req:  &token.LoginRequest{Email: "a@b.com", Password: "correct-password"},
			setup: func(ur *mockUserRepo, urr *mockUserRoleRepo, auth *mockAuther) {
				ur.On("GetUserByEmail", mock.Anything, "a@b.com").
					Return(&rolerepo.UserModel{
						ID: 1, Username: "alice", Email: "a@b.com", Password: pw, Status: 1,
					}, nil)
				urr.On("ListRolesByUser", mock.Anything, int64(1), mock.Anything, mock.Anything).
					Return([]*rolerepo.RoleModel{{Name: "admin", Code: "admin"}}, int64(1), nil)
				auth.On("GenerateToken", mock.Anything, mock.MatchedBy(func(info *jwtx.UserInfo) bool {
					return info.Name == "alice"
				})).Return(&stubTokenInfo{accessToken: "jwt-token", tokenType: "Bearer", expiresAt: 9999}, nil)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, ur, _, urr, _, auth := newTestService()
			if tt.setup != nil {
				tt.setup(ur, urr, auth)
			}

			resp, err := svc.Login(context.Background(), tt.req)
			if tt.wantErr {
				require.Error(t, err)
				if tt.errCode != 0 {
					ae, ok := apperr.As(err)
					require.True(t, ok, "expected apperr, got: %v", err)
					assert.Equal(t, tt.errCode, ae.Code())
				}
				return
			}

			require.NoError(t, err)
			require.NotNil(t, resp.Data)
			assert.Equal(t, "jwt-token", resp.Data.TokenInfo.AccessToken)
			assert.Equal(t, "alice", resp.Data.User.Username)
		})
	}
}

// ─── Logout ─────────────────────────────────────────────────────────────────────

func TestLogout(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		svc, _, _, _, _, auth := newTestService()
		auth.On("DestroyToken", mock.Anything, "tok").Return(nil)
		resp, err := svc.Logout(context.Background(), "tok")
		require.NoError(t, err)
		require.NotNil(t, resp)
	})

	t.Run("destroy error propagates", func(t *testing.T) {
		svc, _, _, _, _, auth := newTestService()
		auth.On("DestroyToken", mock.Anything, "tok").Return(errors.New("redis down"))
		_, err := svc.Logout(context.Background(), "tok")
		require.Error(t, err)
	})
}

// ─── RefreshToken ───────────────────────────────────────────────────────────────

func TestRefreshToken(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		svc, _, _, _, _, auth := newTestService()
		auth.On("DestroyToken", mock.Anything, "old").Return(nil)
		auth.On("GenerateToken", mock.Anything, mock.Anything).
			Return(&stubTokenInfo{accessToken: "new-jwt", tokenType: "Bearer", expiresAt: 9999}, nil)

		resp, err := svc.RefreshToken(context.Background(), "old", &jwtx.UserInfo{Name: "alice"})
		require.NoError(t, err)
		assert.Equal(t, "new-jwt", resp.Data.TokenInfo.AccessToken)
	})

	t.Run("old token destroy failure is non-blocking", func(t *testing.T) {
		svc, _, _, _, _, auth := newTestService()
		auth.On("DestroyToken", mock.Anything, "old").Return(errors.New("fail"))
		auth.On("GenerateToken", mock.Anything, mock.Anything).
			Return(&stubTokenInfo{accessToken: "new"}, nil)

		resp, err := svc.RefreshToken(context.Background(), "old", &jwtx.UserInfo{Name: "bob"})
		require.NoError(t, err)
		assert.Equal(t, "new", resp.Data.TokenInfo.AccessToken)
	})
}

// ─── ResetPassword ──────────────────────────────────────────────────────────────

func TestResetPassword(t *testing.T) {
	pw := hashedPassword("old-pw")

	t.Run("nil request", func(t *testing.T) {
		svc, _, _, _, _, _ := newTestService()
		_, err := svc.ResetPassword(context.Background(), nil)
		require.Error(t, err)
	})

	t.Run("incorrect old password", func(t *testing.T) {
		svc, ur, _, _, _, _ := newTestService()
		ur.On("GetUserByID", mock.Anything, int64(1)).
			Return(&rolerepo.UserModel{ID: 1, Password: pw}, nil)

		_, err := svc.ResetPassword(context.Background(), &user.ResetPasswordRequest{
			Id: 1, OldPassword: "wrong", NewPassword: "new-pw",
		})
		require.Error(t, err)
		ae, ok := apperr.As(err)
		require.True(t, ok)
		assert.Equal(t, errcode.RBACIncorrectOldPassword, ae.Code())
	})

	t.Run("success", func(t *testing.T) {
		svc, ur, _, _, _, _ := newTestService()
		ur.On("GetUserByID", mock.Anything, int64(1)).
			Return(&rolerepo.UserModel{ID: 1, Password: pw}, nil)
		ur.On("UpdatePassword", mock.Anything, int64(1), mock.Anything).Return(nil)

		_, err := svc.ResetPassword(context.Background(), &user.ResetPasswordRequest{
			Id: 1, OldPassword: "old-pw", NewPassword: "new-pw",
		})
		require.NoError(t, err)
	})
}

// ─── CreateRole ─────────────────────────────────────────────────────────────────

func TestCreateRole(t *testing.T) {
	t.Run("nil request", func(t *testing.T) {
		svc, _, _, _, _, _ := newTestService()
		_, err := svc.CreateRole(context.Background(), nil)
		require.Error(t, err)
	})

	t.Run("duplicate code", func(t *testing.T) {
		svc, _, rr, _, _, _ := newTestService()
		rr.On("GetRoleByCode", mock.Anything, "admin").
			Return(&rolerepo.RoleModel{ID: 1, Code: "admin"}, nil)

		_, err := svc.CreateRole(context.Background(), &role.CreateRoleRequest{Code: "admin"})
		require.Error(t, err)
		ae, _ := apperr.As(err)
		assert.Equal(t, errcode.RBACRoleCodeAlreadyExists, ae.Code())
	})

	t.Run("success", func(t *testing.T) {
		svc, _, rr, _, _, _ := newTestService()
		rr.On("GetRoleByCode", mock.Anything, "editor").Return(nil, gorm.ErrRecordNotFound)
		rr.On("CreateRole", mock.Anything, mock.Anything).Return(nil)

		resp, err := svc.CreateRole(context.Background(), &role.CreateRoleRequest{Code: "editor", Name: "Editor"})
		require.NoError(t, err)
		assert.Greater(t, resp.Data.Id, int64(0))
	})
}

// ─── UpdateRole ─────────────────────────────────────────────────────────────────

func TestUpdateRole(t *testing.T) {
	t.Run("not found", func(t *testing.T) {
		svc, _, rr, _, _, _ := newTestService()
		rr.On("GetRole", mock.Anything, int64(99)).Return(nil, gorm.ErrRecordNotFound)

		_, err := svc.UpdateRole(context.Background(), &role.UpdateRoleRequest{Id: 99, Name: "x"})
		require.Error(t, err)
	})

	t.Run("success", func(t *testing.T) {
		svc, _, rr, _, _, _ := newTestService()
		rr.On("GetRole", mock.Anything, int64(1)).Return(&rolerepo.RoleModel{ID: 1, Name: "Old"}, nil)
		rr.On("UpdateRole", mock.Anything, mock.MatchedBy(func(r *rolerepo.RoleModel) bool {
			return r.Name == "New"
		})).Return(nil)

		_, err := svc.UpdateRole(context.Background(), &role.UpdateRoleRequest{Id: 1, Name: "New"})
		require.NoError(t, err)
	})
}

// ─── DeleteRole ─────────────────────────────────────────────────────────────────

func TestDeleteRole(t *testing.T) {
	t.Run("not found", func(t *testing.T) {
		svc, _, rr, _, _, _ := newTestService()
		rr.On("GetRole", mock.Anything, int64(99)).Return(nil, gorm.ErrRecordNotFound)
		_, err := svc.DeleteRole(context.Background(), &role.DeleteRoleRequest{Id: 99})
		require.Error(t, err)
	})

	t.Run("success without enforcer", func(t *testing.T) {
		svc, _, rr, _, _, _ := newTestService()
		rr.On("GetRole", mock.Anything, int64(1)).Return(&rolerepo.RoleModel{ID: 1}, nil)
		rr.On("DeleteRole", mock.Anything, int64(1)).Return(nil)

		_, err := svc.DeleteRole(context.Background(), &role.DeleteRoleRequest{Id: 1})
		require.NoError(t, err)
	})
}

// ─── AssignUserRole ─────────────────────────────────────────────────────────────

func TestAssignUserRole(t *testing.T) {
	t.Run("missing ids", func(t *testing.T) {
		svc, _, _, _, _, _ := newTestService()
		_, err := svc.AssignUserRole(context.Background(), &user_role.AssignUserRoleRequest{UserId: 0, RoleId: 1})
		require.Error(t, err)
	})

	t.Run("already assigned", func(t *testing.T) {
		svc, ur, rr, urr, _, _ := newTestService()
		ur.On("GetUserByID", mock.Anything, int64(1)).Return(&rolerepo.UserModel{ID: 1, Username: "alice"}, nil)
		rr.On("GetRole", mock.Anything, int64(10)).Return(&rolerepo.RoleModel{ID: 10, Code: "admin"}, nil)
		urr.On("ListRolesByUser", mock.Anything, int64(1), int32(1), int32(1000)).
			Return([]*rolerepo.RoleModel{{ID: 10, Code: "admin"}}, int64(1), nil)

		_, err := svc.AssignUserRole(context.Background(), &user_role.AssignUserRoleRequest{UserId: 1, RoleId: 10})
		require.Error(t, err)
		ae, _ := apperr.As(err)
		assert.Equal(t, errcode.RBACRoleAlreadyAssigned, ae.Code())
	})

	t.Run("success", func(t *testing.T) {
		svc, ur, rr, urr, _, _ := newTestService()
		ur.On("GetUserByID", mock.Anything, int64(1)).Return(&rolerepo.UserModel{ID: 1, Username: "alice"}, nil)
		rr.On("GetRole", mock.Anything, int64(10)).Return(&rolerepo.RoleModel{ID: 10, Code: "admin"}, nil)
		urr.On("ListRolesByUser", mock.Anything, int64(1), int32(1), int32(1000)).
			Return([]*rolerepo.RoleModel{}, int64(0), nil)
		urr.On("Assign", mock.Anything, mock.Anything).Return(nil)

		_, err := svc.AssignUserRole(
			context.Background(),
			&user_role.AssignUserRoleRequest{UserId: 1, RoleId: 10},
		)
		require.NoError(t, err)
	})
}

// ─── RemoveUserRole ─────────────────────────────────────────────────────────────

func TestRemoveUserRole(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		svc, _, _, urr, _, _ := newTestService()
		urr.On("Remove", mock.Anything, int64(1), int64(10)).Return(nil)
		_, err := svc.RemoveUserRole(context.Background(), &user_role.RemoveUserRoleRequest{UserId: 1, RoleId: 10})
		require.NoError(t, err)
	})
}

// ─── ListUserRoles ──────────────────────────────────────────────────────────────

func TestListUserRoles(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		svc, _, _, urr, _, _ := newTestService()
		urr.On("ListRolesByUser", mock.Anything, int64(1), int32(1), int32(20)).
			Return([]*rolerepo.RoleModel{{ID: 10, Code: "admin", Name: "Admin"}}, int64(1), nil)

		resp, err := svc.ListUserRoles(
			context.Background(),
			&user_role.ListUserRolesRequest{UserId: 1, Page: 1, PageSize: 20},
		)
		require.NoError(t, err)
		assert.Len(t, resp.Data.Roles, 1)
		assert.Equal(t, "admin", resp.Data.Roles[0].Code)
	})
}

// ─── QueryRoles ─────────────────────────────────────────────────────────────────

func TestQueryRoles(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		svc, _, rr, _, _, _ := newTestService()
		rr.On("QueryRoles", mock.Anything, "", "", mock.Anything, int32(1), int32(20)).
			Return([]*rolerepo.RoleModel{
				{ID: 1, Code: "admin", Name: "Admin"},
				{ID: 2, Code: "user", Name: "User"},
			}, int64(2), nil)

		resp, err := svc.QueryRoles(context.Background(), &role.QueryRolesRequest{Page: 1, PageSize: 20})
		require.NoError(t, err)
		assert.Len(t, resp.Data.Roles, 2)
	})
}

// ─── policy helpers ─────────────────────────────────────────────────────────────

func TestPolicyHelpers(t *testing.T) {
	t.Run("normalizePolicyRule pads to 6", func(t *testing.T) {
		result := normalizePolicyRule([]string{"a", "b"})
		assert.Len(t, result, 6)
		assert.Equal(t, "a", result[0])
		assert.Equal(t, "", result[5])
	})

	t.Run("normalizePolicyRule nil input", func(t *testing.T) {
		result := normalizePolicyRule(nil)
		assert.Len(t, result, 6)
		for _, v := range result {
			assert.Equal(t, "", v)
		}
	})

	t.Run("policyRuleParams trims trailing empty fields but keeps at least 3", func(t *testing.T) {
		params := policyRuleParams([]string{"admin", "/api/users", "GET"})
		assert.Len(t, params, 3)
		assert.Equal(t, "admin", params[0])
	})

	t.Run("policyRuleParams with extra fields", func(t *testing.T) {
		params := policyRuleParams([]string{"admin", "/api", "GET", "extra", "", ""})
		assert.Len(t, params, 4)
	})

	t.Run("trimPolicyRule", func(t *testing.T) {
		result := trimPolicyRule([]string{"a", "b", "c", "", "", ""})
		assert.Equal(t, []string{"a", "b", "c"}, result)
	})

	t.Run("equalPolicyRules true", func(t *testing.T) {
		assert.True(t, equalPolicyRules([]string{"a", "b"}, []string{"a", "b", "", "", "", ""}))
	})

	t.Run("equalPolicyRules false", func(t *testing.T) {
		assert.False(t, equalPolicyRules([]string{"a", "b"}, []string{"a", "c"}))
	})
}

// ─── converter helpers ──────────────────────────────────────────────────────────

func TestConverters(t *testing.T) {
	t.Run("rolePo2Pb", func(t *testing.T) {
		po := &rolerepo.RoleModel{
			ID: 1, Code: "admin", Name: "Admin", Description: "desc",
			Status: 1, CreatedAt: 1000, UpdatedAt: 2000,
		}
		pb := rolePo2Pb(po)
		assert.Equal(t, int64(1), pb.Id)
		assert.Equal(t, "admin", pb.Code)
		assert.Equal(t, int64(1), pb.CreatedAt)   // 1000/1000
		assert.Equal(t, int64(2), pb.UpdatedAt)
	})

	t.Run("casbinRulePo2Pb", func(t *testing.T) {
		po := &rolerepo.PolicyModel{ID: 5, Ptype: "p", V0: "admin", V1: "/api", V2: "GET"}
		pb := casbinRulePo2Pb(po)
		assert.Equal(t, int64(5), pb.Id)
		assert.Equal(t, "p", pb.Ptype)
		assert.Equal(t, "admin", pb.V0)
	})

	t.Run("userPo2Do", func(t *testing.T) {
		po := &rolerepo.UserModel{
			ID: 1, Alias_: "Alice", Username: "alice", Email: "a@b.com",
			Phone: "123", IconURI: "icon.png", Status: 1, CreatedAt: 5000, UpdatedAt: 6000,
		}
		do := userPo2Do(po)
		assert.Equal(t, int64(1), do.Id)
		assert.Equal(t, "Alice", do.Alias)
		assert.Equal(t, "icon.png", do.IconUri)
		assert.Equal(t, "icon.png", do.RawIconUri)
		assert.Equal(t, int64(5), do.CreatedAt)  // 5000/1000
		assert.Equal(t, rbacCommon.UserStatus(1), do.Status)
	})
}
