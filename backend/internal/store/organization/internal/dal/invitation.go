package dal

import (
	"context"

	"gorm.io/gorm"

	"sico-backend/internal/store/organization/internal/dal/model"
)

type InvitationDAO struct {
	db *gorm.DB
}

func NewInvitationDAO(db *gorm.DB) *InvitationDAO {
	return &InvitationDAO{db: db}
}

func (d *InvitationDAO) Create(ctx context.Context, invitation *model.TOrganizationInvitation) error {
	return d.db.WithContext(ctx).Create(invitation).Error
}

func (d *InvitationDAO) GetByID(ctx context.Context, id int64) (*model.TOrganizationInvitation, error) {
	var invitation model.TOrganizationInvitation
	if err := d.db.WithContext(ctx).Where("id = ?", id).First(&invitation).Error; err != nil {
		return nil, err
	}
	return &invitation, nil
}

func (d *InvitationDAO) GetByTokenHash(
	ctx context.Context,
	tokenHash string,
) (*model.TOrganizationInvitation, error) {
	var invitation model.TOrganizationInvitation
	if err := d.db.WithContext(ctx).Where("token_hash = ?", tokenHash).First(&invitation).Error; err != nil {
		return nil, err
	}
	return &invitation, nil
}

func (d *InvitationDAO) ListByOrganization(
	ctx context.Context,
	organizationID int64,
	page, pageSize int32,
) ([]*model.TOrganizationInvitation, int64, error) {
	query := d.db.WithContext(ctx).Model(&model.TOrganizationInvitation{}).
		Where("organization_id = ?", organizationID)

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var invitations []*model.TOrganizationInvitation
	if err := query.Offset(int((page - 1) * pageSize)).Limit(int(pageSize)).
		Order("id DESC").Find(&invitations).Error; err != nil {
		return nil, 0, err
	}
	return invitations, total, nil
}

func (d *InvitationDAO) Revoke(ctx context.Context, id, organizationID, revokedAt int64) error {
	result := d.db.WithContext(ctx).Model(&model.TOrganizationInvitation{}).
		Where("id = ? AND organization_id = ? AND revoked_at = 0", id, organizationID).
		Updates(map[string]any{"revoked_at": revokedAt, "updated_at": revokedAt})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}
