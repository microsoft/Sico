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
	return dal.NewUserDAO(db)
}
