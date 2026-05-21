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

package enforcer

import (
	"context"
	"fmt"
	"strings"

	"github.com/casbin/casbin/v2"
	casbinModel "github.com/casbin/casbin/v2/model"
	"github.com/casbin/casbin/v2/persist"
	"gorm.io/gorm"

	dalmodel "sico-backend/internal/store/rbac/internal/dal/model"
)

// gormAdapter implements casbin persist.Adapter using internal model (within same package allowed).
type gormAdapter struct{ DB *gorm.DB }

var ruleColumns = []string{"v0", "v1", "v2", "v3", "v4", "v5"}

func NewGormAdapter(db *gorm.DB) persist.Adapter { return &gormAdapter{DB: db} }

func (a *gormAdapter) LoadPolicy(m casbinModel.Model) error {
	var rules []*dalmodel.TCasbinRule
	if err := a.DB.WithContext(context.Background()).Find(&rules).Error; err != nil {
		return err
	}

	for _, r := range rules {
		line := buildPolicyLine(r)
		err := persist.LoadPolicyLine(line, m)
		if err != nil {
			return err
		}
	}

	return nil
}
func (a *gormAdapter) SavePolicy(m casbinModel.Model) error {
	if err := a.DB.WithContext(context.Background()).Where("1=1").Delete(&dalmodel.TCasbinRule{}).Error; err != nil {
		return err
	}

	for _, po := range collectPolicyRules(m) {
		if err := a.DB.Create(po).Error; err != nil {
			return err
		}
	}

	return nil
}

// collectPolicyRules flattens the casbin model's p/g sections into persistable rule rows.
func collectPolicyRules(m casbinModel.Model) []*dalmodel.TCasbinRule {
	var (
		rules    []*dalmodel.TCasbinRule
		sections = []string{"p", "g"}
	)

	for _, sec := range sections {
		for ptype, ast := range m[sec] {
			for _, rule := range ast.Policy {
				rules = append(rules, buildRuleFromPolicy(ptype, rule))
			}
		}
	}
	return rules
}

// buildRuleFromPolicy converts a single casbin policy tuple to a TCasbinRule row.
func buildRuleFromPolicy(ptype string, rule []string) *dalmodel.TCasbinRule {
	po := &dalmodel.TCasbinRule{Ptype: ptype}

	if len(rule) > 0 {
		po.V0 = rule[0]
	}
	if len(rule) > 1 {
		po.V1 = rule[1]
	}
	if len(rule) > 2 {
		po.V2 = rule[2]
	}
	if len(rule) > 3 {
		po.V3 = rule[3]
	}
	if len(rule) > 4 {
		po.V4 = rule[4]
	}
	if len(rule) > 5 {
		po.V5 = rule[5]
	}

	return po
}

func (a *gormAdapter) AddPolicy(sec, ptype string, rule []string) error {
	po := &dalmodel.TCasbinRule{Ptype: ptype}
	if len(rule) > 0 {
		po.V0 = rule[0]
	}
	if len(rule) > 1 {
		po.V1 = rule[1]
	}
	if len(rule) > 2 {
		po.V2 = rule[2]
	}
	if len(rule) > 3 {
		po.V3 = rule[3]
	}
	if len(rule) > 4 {
		po.V4 = rule[4]
	}
	if len(rule) > 5 {
		po.V5 = rule[5]
	}

	return a.DB.Create(po).Error
}

func (a *gormAdapter) RemovePolicy(sec, ptype string, rule []string) error {
	vals := normalizeRule(rule)
	q := a.DB.WithContext(context.Background()).Where("ptype = ?", ptype)
	for i, v := range vals {
		q = q.Where(ruleColumns[i]+" = ?", v)
	}

	return q.Delete(&dalmodel.TCasbinRule{}).Error
}

func (a *gormAdapter) RemoveFilteredPolicy(sec, ptype string, fieldIndex int, fieldValues ...string) error {
	return applyRuleFilter(a.DB.WithContext(context.Background()), ptype, fieldIndex, fieldValues).
		Delete(&dalmodel.TCasbinRule{}).Error
}

func (a *gormAdapter) UpdatePolicy(sec, ptype string, oldRule, newRule []string) error {
	oldVals := normalizeRule(oldRule)
	newVals := normalizeRule(newRule)

	q := a.DB.WithContext(context.Background()).Model(&dalmodel.TCasbinRule{}).Where("ptype = ?", ptype)
	for i, v := range oldVals {
		q = q.Where(ruleColumns[i]+" = ?", v)
	}

	updates := map[string]interface{}{}
	for i, col := range ruleColumns {
		updates[col] = newVals[i]
	}

	res := q.Updates(updates)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}

	return nil
}

func (a *gormAdapter) UpdatePolicies(sec, ptype string, oldRules, newRules [][]string) error {
	if len(oldRules) != len(newRules) {
		return fmt.Errorf("mismatched policy batch sizes: %d vs %d", len(oldRules), len(newRules))
	}

	for i := range oldRules {
		if err := a.UpdatePolicy(sec, ptype, oldRules[i], newRules[i]); err != nil {
			return err
		}
	}

	return nil
}

func (a *gormAdapter) UpdateFilteredPolicies(
	sec, ptype string, newRules [][]string, fieldIndex int, fieldValues ...string,
) ([][]string, error) {
	var removed [][]string

	err := a.DB.WithContext(context.Background()).Transaction(func(tx *gorm.DB) error {
		filtered := applyRuleFilter(tx.Model(&dalmodel.TCasbinRule{}), ptype, fieldIndex, fieldValues)

		var current []*dalmodel.TCasbinRule
		if err := filtered.Find(&current).Error; err != nil {
			return err
		}

		removed = make([][]string, len(current))
		for i, rule := range current {
			removed[i] = trimRule([]string{rule.V0, rule.V1, rule.V2, rule.V3, rule.V4, rule.V5})
		}

		if len(current) > 0 {
			if err := applyRuleFilter(tx.Model(&dalmodel.TCasbinRule{}), ptype, fieldIndex, fieldValues).
				Delete(&dalmodel.TCasbinRule{}).Error; err != nil {
				return err
			}
		}

		for _, rule := range newRules {
			norm := normalizeRule(rule)
			po := &dalmodel.TCasbinRule{
				Ptype: ptype,
				V0:    norm[0],
				V1:    norm[1],
				V2:    norm[2],
				V3:    norm[3],
				V4:    norm[4],
				V5:    norm[5],
			}
			if err := tx.Create(po).Error; err != nil {
				return err
			}
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	return removed, nil
}

func normalizeRule(rule []string) []string {
	const fieldCount = 6
	normalized := make([]string, fieldCount)
	copy(normalized, rule)
	return normalized
}

func buildPolicyLine(r *dalmodel.TCasbinRule) string {
	trimmed := trimRule([]string{r.V0, r.V1, r.V2, r.V3, r.V4, r.V5})

	if len(trimmed) == 0 {
		return r.Ptype
	}

	return fmt.Sprintf("%s, %s", r.Ptype, strings.Join(trimmed, ", "))
}

func trimRule(rule []string) []string {
	last := len(rule)
	for last > 0 && rule[last-1] == "" {
		last--
	}
	return rule[:last]
}

func applyRuleFilter(db *gorm.DB, ptype string, fieldIndex int, fieldValues []string) *gorm.DB {
	q := db.Where("ptype = ?", ptype)
	for i, v := range fieldValues {
		idx := fieldIndex + i
		if idx >= len(ruleColumns) {
			break
		}
		if v != "" {
			q = q.Where(ruleColumns[idx]+" = ?", v)
		}
	}
	return q
}

// ProvideCasbinEnforcer constructs an enforcer with gorm adapter and basic RBAC model.
func ProvideCasbinEnforcer(db *gorm.DB) (*casbin.Enforcer, error) {
	mdlText := `
[request_definition]
 r = sub, obj, act

[policy_definition]
 p = sub, obj, act

[role_definition]
 g = _, _

[policy_effect]
 e = some(where (p.eft == allow))

[matchers]
 m = r.sub == p.sub && r.obj == p.obj && r.act == p.act || g(r.sub, p.sub)
`
	m, err := casbinModel.NewModelFromString(mdlText)
	if err != nil {
		return nil, err
	}

	adapter := NewGormAdapter(db)
	enf, err := casbin.NewEnforcer(m, adapter)
	if err != nil {
		return nil, err
	}
	if err = enf.LoadPolicy(); err != nil {
		return nil, err
	}

	return enf, nil
}
