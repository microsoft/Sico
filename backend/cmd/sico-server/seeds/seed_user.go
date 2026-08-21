package seeds

import (
	"context"
	"errors"

	"gorm.io/gorm"

	"sico-backend/internal/di"
	userrepo "sico-backend/internal/store/rbac/repository"
	rbacCommon "sico-backend/internal/transport/http/dto/rbac/common"
	"sico-backend/pkg/crypto/hash"
	"sico-backend/pkg/logger"
)

func checkDefaultOperatorUser(ctx context.Context, injector *di.Injector) error {
	repo := userrepo.NewUserRepository(injector.DB)

	existingUser, err := repo.GetUserByUsername(ctx, defaultOperatorUser)
	if err != nil && err != gorm.ErrRecordNotFound {
		return err
	}
	if existingUser != nil {
		return nil
	}
	return createDefaultOperatorUser(ctx, injector, repo)
}

func createDefaultOperatorUser(ctx context.Context, injector *di.Injector, repo userrepo.UserRepository) error {
	hashedPassword, err := hash.GeneratePassword(defaultOperatorPassword)
	if err != nil {
		return err
	}

	u := &userrepo.UserModel{
		Username: defaultOperatorUser,
		Alias_:   defaultOperatorAlias,
		Password: hashedPassword,
		Email:    defaultOperatorEmail,
		Status:   int32(rbacCommon.UserStatus_USER_STATUS_ACTIVE),
	}

	err = repo.CreateUser(ctx, u)
	if err == nil {
		return nil
	}
	if !errors.Is(err, gorm.ErrDuplicatedKey) {
		return err
	}

	logger.CtxWarn(ctx, "Default operator user already exists but is marked as deleted, trying to recover it")
	injector.DB.WithContext(ctx).Exec(
		"UPDATE t_user SET deleted_at = null WHERE username = ?", defaultOperatorUser)

	// update other fields to make sure the default operator user is correct
	return repo.UpdateUser(ctx, u)
}
