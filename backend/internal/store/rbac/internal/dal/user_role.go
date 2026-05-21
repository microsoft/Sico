package dal

import (
	"context"

	"gorm.io/gorm"

	"sico-backend/internal/store/rbac/internal/dal/model"
)

type UserRoleDAO struct {
	db *gorm.DB
}

func NewUserRoleDAO(db *gorm.DB) *UserRoleDAO {
	return &UserRoleDAO{db: db}
}

func (d *UserRoleDAO) Assign(ctx context.Context, ur *model.TUserRole) error {
	return d.db.WithContext(ctx).Create(ur).Error
}

func (d *UserRoleDAO) Remove(ctx context.Context, userID, roleID int64) error {
	return d.db.WithContext(ctx).
		Where("user_id = ? AND role_id = ?", userID, roleID).
		Delete(&model.TUserRole{}).Error
}

func (d *UserRoleDAO) ListRolesByUser(ctx context.Context, userID int64, page, pageSize int32) ([]*model.TRole, int64, error) {
	var total int64
	if err := d.db.WithContext(ctx).Model(&model.TUserRole{}).Where("user_id = ?", userID).Count(&total).Error; err != nil {
		return nil, 0, err
	}

	offset := int((page - 1) * pageSize)
	var roles []*model.TRole
	if err := d.db.WithContext(ctx).
		Table("t_role").
		Joins("INNER JOIN t_user_role ON t_role.id = t_user_role.role_id").
		Where("t_user_role.user_id = ? AND t_user_role.deleted_at IS NULL AND t_role.deleted_at IS NULL", userID).
		Offset(offset).Limit(int(pageSize)).
		Find(&roles).Error; err != nil {
		return nil, 0, err
	}

	return roles, total, nil
}

func (d *UserRoleDAO) ListUsersByRole(ctx context.Context, roleID int64, page, pageSize int32) ([]*model.TUser, int64, error) {
	var total int64
	if err := d.db.WithContext(ctx).Model(&model.TUserRole{}).Where("role_id = ?", roleID).Count(&total).Error; err != nil {
		return nil, 0, err
	}

	offset := int((page - 1) * pageSize)
	var users []*model.TUser
	if err := d.db.WithContext(ctx).
		Table("t_user").
		Joins("INNER JOIN t_user_role ON t_user.id = t_user_role.user_id").
		Where("t_user_role.role_id = ? AND t_user_role.deleted_at IS NULL AND t_user.deleted_at IS NULL", roleID).
		Offset(offset).Limit(int(pageSize)).
		Find(&users).Error; err != nil {
		return nil, 0, err
	}

	return users, total, nil
}
