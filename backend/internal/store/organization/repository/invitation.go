package repository

import (
	"context"

	"gorm.io/gorm"

	"sico-backend/internal/store/organization/internal/dal"
	"sico-backend/internal/store/organization/internal/dal/model"
)

type InvitationModel = model.TOrganizationInvitation

type InvitationRepository interface {
	Create(ctx context.Context, invitation *InvitationModel) error
	GetByID(ctx context.Context, id int64) (*InvitationModel, error)
	GetByTokenHash(ctx context.Context, tokenHash string) (*InvitationModel, error)
	ListByOrganization(
		ctx context.Context,
		organizationID int64,
		page, pageSize int32,
	) ([]*InvitationModel, int64, error)
	Revoke(ctx context.Context, id, organizationID, revokedAt int64) error
}

func NewInvitationRepository(db *gorm.DB) InvitationRepository {
	return WithTracingInvitationRepository(dal.NewInvitationDAO(db))
}
