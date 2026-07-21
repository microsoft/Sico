package dal

import (
	"context"

	"gorm.io/gorm"

	"sico-backend/internal/store/rbac/internal/dal/model"
)

// UserRoleFilter represents query filters for listing user roles.
type UserRoleFilter struct {
	UserID    int64
	RoleCode  string
	ScopeType string
	ScopeID   int64
	Offset    int
	Limit     int
}

type UserRoleDAO struct {
	db *gorm.DB
}

func NewUserRoleDAO(db *gorm.DB) *UserRoleDAO {
	return &UserRoleDAO{db: db}
}

func (d *UserRoleDAO) Assign(ctx context.Context, ur *model.TUserRole) error {
	return d.db.WithContext(ctx).Create(ur).Error
}

func (d *UserRoleDAO) Remove(
	ctx context.Context, userID int64, roleCode, scopeType string, scopeID int64,
) error {
	return d.db.WithContext(ctx).
		Where("user_id = ? AND role_code = ? AND scope_type = ? AND scope_id = ?",
			userID, roleCode, scopeType, scopeID).
		Delete(&model.TUserRole{}).Error
}

// List returns user roles matching the filter. If Limit is 0, all matching rows are returned.
func (d *UserRoleDAO) List(ctx context.Context, filter *UserRoleFilter) ([]*model.TUserRole, int64, error) {
	q := d.db.WithContext(ctx).Model(&model.TUserRole{})

	if filter.UserID > 0 {
		q = q.Where("user_id = ?", filter.UserID)
	}
	if filter.RoleCode != "" {
		q = q.Where("role_code = ?", filter.RoleCode)
	}
	if filter.ScopeType != "" {
		q = q.Where("scope_type = ?", filter.ScopeType)
	}
	if filter.ScopeID > 0 {
		q = q.Where("scope_id = ?", filter.ScopeID)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if filter.Offset > 0 {
		q = q.Offset(filter.Offset)
	}
	if filter.Limit > 0 {
		q = q.Limit(filter.Limit)
	}

	var list []*model.TUserRole
	if err := q.Find(&list).Error; err != nil {
		return nil, 0, err
	}
	return list, total, nil
}
