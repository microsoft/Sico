package repository

import (
	"context"

	"gorm.io/gorm"

	entity "sico-backend/internal/entity/rbac"
	"sico-backend/internal/store/rbac/internal/dal"
	"sico-backend/internal/store/rbac/internal/dal/model"
)

type UserModel = model.TUser

type UserRepository interface {
	CreateUser(ctx context.Context, user *UserModel) error
	UpdateUser(ctx context.Context, user *UserModel) error
	UpdateUserFields(ctx context.Context, id int64, fields map[string]interface{}) error
	DeleteUser(ctx context.Context, id int64) error
	GetUserByID(ctx context.Context, id int64) (*UserModel, error)
	GetUserByUsername(ctx context.Context, username string) (*UserModel, error)
	GetUserByEmail(ctx context.Context, email string) (*UserModel, error)
	QueryUsers(ctx context.Context, filter *entity.UserFilter, page, pageSize int32) ([]*UserModel, int64, error)
	UpdatePassword(ctx context.Context, id int64, hashedPassword string) error
	GetUsersByIDs(ctx context.Context, ids []int64) ([]*UserModel, error)
}

func NewUserRepository(db *gorm.DB) UserRepository {
	return WithTracingUserRepository(dal.NewUserDAO(db))
}
