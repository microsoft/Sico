package repository

import (
	"context"

	"gorm.io/gorm"

	"sico-backend/internal/store/rbac/internal/dal"
	"sico-backend/internal/store/rbac/internal/dal/model"
)

type UserRoleModel = model.TUserRole

// UserRoleFilter is re-exported from the DAL layer for convenience.
type UserRoleFilter = dal.UserRoleFilter

type UserRoleRepository interface {
	Assign(ctx context.Context, ur *UserRoleModel) error
	Remove(ctx context.Context, userID int64, roleCode, scopeType string, scopeID string) error
	List(ctx context.Context, filter *UserRoleFilter) ([]*UserRoleModel, int64, error)
}

func NewUserRoleRepository(db *gorm.DB) UserRoleRepository {
	return WithTracingUserRoleRepository(dal.NewUserRoleDAO(db))
}
