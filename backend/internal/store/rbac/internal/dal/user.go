package dal

import (
	"context"

	"gorm.io/gorm"

	entity "sico-backend/internal/entity/rbac"
	"sico-backend/internal/store/rbac/internal/dal/model"
)

type UserDAO struct {
	db *gorm.DB
}

func NewUserDAO(db *gorm.DB) *UserDAO {
	return &UserDAO{db: db}
}

func (d *UserDAO) CreateUser(ctx context.Context, user *model.TUser) error {
	return d.db.WithContext(ctx).Create(user).Error
}

func (d *UserDAO) UpdateUser(ctx context.Context, user *model.TUser) error {
	return d.db.WithContext(ctx).Model(&model.TUser{}).Where("id = ?", user.ID).Updates(user).Error
}

func (d *UserDAO) UpdateUserFields(ctx context.Context, id int64, fields map[string]interface{}) error {
	return d.db.WithContext(ctx).Model(&model.TUser{}).Where("id = ?", id).Updates(fields).Error
}

func (d *UserDAO) DeleteUser(ctx context.Context, id int64) error {
	return d.db.WithContext(ctx).Where("id = ?", id).Delete(&model.TUser{}).Error
}

func (d *UserDAO) GetUserByID(ctx context.Context, id int64) (*model.TUser, error) {
	var u model.TUser
	if err := d.db.WithContext(ctx).Where("id = ?", id).First(&u).Error; err != nil {
		return nil, err
	}
	return &u, nil
}

func (d *UserDAO) GetUserByUsername(ctx context.Context, username string) (*model.TUser, error) {
	var u model.TUser
	if err := d.db.WithContext(ctx).Where("username = ?", username).First(&u).Error; err != nil {
		return nil, err
	}
	return &u, nil
}

func (d *UserDAO) GetUserByEmail(ctx context.Context, email string) (*model.TUser, error) {
	var u model.TUser
	if err := d.db.WithContext(ctx).Where("email = ?", email).First(&u).Error; err != nil {
		return nil, err
	}
	return &u, nil
}

func (d *UserDAO) QueryUsers(
	ctx context.Context, filter *entity.UserFilter, page, pageSize int32,
) ([]*model.TUser, int64, error) {
	q := d.db.WithContext(ctx).Model(&model.TUser{})

	if filter.Alias != "" {
		q = q.Where("alias LIKE ?", "%"+filter.Alias+"%")
	}
	if filter.Email != "" {
		q = q.Where("email LIKE ?", "%"+filter.Email+"%")
	}
	if filter.Phone != "" {
		q = q.Where("phone LIKE ?", "%"+filter.Phone+"%")
	}
	if len(filter.StatusList) > 0 {
		q = q.Where("status IN ?", filter.StatusList)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	offset := int((page - 1) * pageSize)
	var users []*model.TUser
	if err := q.Offset(offset).Limit(int(pageSize)).Find(&users).Error; err != nil {
		return nil, 0, err
	}

	return users, total, nil
}

func (d *UserDAO) UpdatePassword(ctx context.Context, id int64, hashedPassword string) error {
	return d.db.WithContext(ctx).Model(&model.TUser{}).Where("id = ?", id).Update("password", hashedPassword).Error
}
