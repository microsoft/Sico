package repository

import (
	"context"

	"gorm.io/gorm"

	"sico-backend/internal/store/authstate/internal/dal"
	authStateModel "sico-backend/internal/store/authstate/internal/dal/model"
)

type AuthStateModel = authStateModel.TAuthState

const (
	AuthStateStatusUnknown  int32 = 0
	AuthStateStatusValid    int32 = 1
	AuthStateStatusExpired  int32 = 2
	AuthStateStatusDisabled int32 = 3
)

type AuthStateRepository interface {
	GetByAccountSite(
		ctx context.Context,
		accountKey, siteHost string,
	) (*AuthStateModel, error)
	Upsert(ctx context.Context, model *AuthStateModel) (int64, error)
	UpdateStatus(
		ctx context.Context,
		accountKey, siteHost string,
		status int32,
	) error
}

func NewAuthStateRepo(db *gorm.DB) AuthStateRepository {
	return WithTracingAuthStateRepository(dal.NewAuthStateDAO(db))
}
