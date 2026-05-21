package dal

import (
	"context"

	"gorm.io/gorm"

	"sico-backend/internal/store/rbac/internal/dal/model"
)

type CasbinRuleDAO struct {
	db *gorm.DB
}

func NewCasbinRuleDAO(db *gorm.DB) *CasbinRuleDAO {
	return &CasbinRuleDAO{db: db}
}

func (d *CasbinRuleDAO) Create(ctx context.Context, rule *model.TCasbinRule) error {
	return d.db.WithContext(ctx).Create(rule).Error
}

func (d *CasbinRuleDAO) Update(ctx context.Context, rule *model.TCasbinRule) error {
	return d.db.WithContext(ctx).Model(&model.TCasbinRule{}).Where("id = ?", rule.ID).Updates(rule).Error
}

func (d *CasbinRuleDAO) Delete(ctx context.Context, id int64) error {
	return d.db.WithContext(ctx).Where("id = ?", id).Delete(&model.TCasbinRule{}).Error
}

func (d *CasbinRuleDAO) Get(ctx context.Context, id int64) (*model.TCasbinRule, error) {
	var r model.TCasbinRule
	if err := d.db.WithContext(ctx).Where("id = ?", id).First(&r).Error; err != nil {
		return nil, err
	}
	return &r, nil
}

func (d *CasbinRuleDAO) GetByRule(ctx context.Context, ptype string, rule []string) (*model.TCasbinRule, error) {
	q := d.db.WithContext(ctx).Where("ptype = ?", ptype)
	fields := []string{"v0", "v1", "v2", "v3", "v4", "v5"}
	for i, v := range rule {
		if i < len(fields) {
			q = q.Where(fields[i]+" = ?", v)
		}
	}
	var r model.TCasbinRule
	if err := q.First(&r).Error; err != nil {
		return nil, err
	}
	return &r, nil
}

func (d *CasbinRuleDAO) Query(
	ctx context.Context, ptype, v0, v1, v2 string, page, pageSize int32,
) ([]*model.TCasbinRule, int64, error) {
	q := d.db.WithContext(ctx).Model(&model.TCasbinRule{})

	if ptype != "" {
		q = q.Where("ptype = ?", ptype)
	}
	if v0 != "" {
		q = q.Where("v0 LIKE ?", "%"+v0+"%")
	}
	if v1 != "" {
		q = q.Where("v1 LIKE ?", "%"+v1+"%")
	}
	if v2 != "" {
		q = q.Where("v2 LIKE ?", "%"+v2+"%")
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	offset := int((page - 1) * pageSize)
	var rules []*model.TCasbinRule
	if err := q.Offset(offset).Limit(int(pageSize)).Find(&rules).Error; err != nil {
		return nil, 0, err
	}

	return rules, total, nil
}
