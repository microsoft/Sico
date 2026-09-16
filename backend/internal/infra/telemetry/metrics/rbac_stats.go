package metrics

import (
	"context"
	"sync"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"gorm.io/gorm"

	"sico-backend/pkg/logger"
)

var rbacStatsOnce sync.Once

type rbacStatsState struct {
	mu               sync.RWMutex
	lastUsers        []userStatusCount
	lastRoleBindings []roleBindingCount
}

type userStatusCount struct {
	Status string
	Tenant string
	Count  int64
}

type roleBindingCount struct {
	RoleCode  string
	ScopeType string
	Count     int64
}

func RegisterRBACStats(db *gorm.DB) {
	rbacStatsOnce.Do(func() {
		if db == nil {
			logger.Error("RBAC metrics not registered: db is nil")
			return
		}

		meter := otel.Meter("sico-backend/rbac")
		usersGauge, err := meter.Int64ObservableGauge(
			"sico.rbac.users_total",
			metric.WithUnit("{user}"),
			metric.WithDescription("Total active users grouped by status and tenant."),
		)
		if err != nil {
			logger.Error("create gauge sico.rbac.users_total failed: %v", err)
			return
		}
		roleBindingsGauge, err := meter.Int64ObservableGauge(
			"sico.rbac.role_bindings_total",
			metric.WithUnit("{binding}"),
			metric.WithDescription("Total active role bindings grouped by role code and scope type."),
		)
		if err != nil {
			logger.Error("create gauge sico.rbac.role_bindings_total failed: %v", err)
			return
		}

		_, err = meter.RegisterCallback(
			rbacStatsCallback(&rbacStatsState{}, db, usersGauge, roleBindingsGauge),
			usersGauge,
			roleBindingsGauge,
		)
		if err != nil {
			logger.Error("register RBAC metrics callback failed: %v", err)
		}
	})
}

func rbacStatsCallback(
	state *rbacStatsState,
	db *gorm.DB,
	usersGauge metric.Int64Observable,
	roleBindingsGauge metric.Int64Observable,
) func(context.Context, metric.Observer) error {
	return func(ctx context.Context, observer metric.Observer) error {
		queryCtx, cancel := context.WithTimeout(ctx, 800*time.Millisecond)
		defer cancel()

		users, roleBindings, err := queryRBACStats(queryCtx, db)
		if err == nil {
			state.mu.Lock()
			state.lastUsers = users
			state.lastRoleBindings = roleBindings
			state.mu.Unlock()
		} else {
			logger.CtxWarn(ctx, "query RBAC metrics failed: %v", err)
		}

		state.mu.RLock()
		defer state.mu.RUnlock()
		for _, user := range state.lastUsers {
			observer.ObserveInt64(usersGauge, user.Count, metric.WithAttributes(
				attribute.String("status", user.Status),
				attribute.String("tenant", user.Tenant),
			))
		}
		for _, binding := range state.lastRoleBindings {
			observer.ObserveInt64(roleBindingsGauge, binding.Count, metric.WithAttributes(
				attribute.String("role_code", binding.RoleCode),
				attribute.String("scope_type", binding.ScopeType),
			))
		}
		return nil
	}
}

func queryRBACStats(ctx context.Context, db *gorm.DB) ([]userStatusCount, []roleBindingCount, error) {
	type userRow struct {
		Status int32
		Tenant string
		Count  int64 `gorm:"column:count"`
	}
	var userRows []userRow
	if err := db.WithContext(ctx).
		Raw("SELECT status, tenant, COUNT(*) AS count FROM t_user WHERE deleted_at IS NULL GROUP BY status, tenant").
		Scan(&userRows).Error; err != nil {
		return nil, nil, err
	}

	const roleBindingsQuery = "SELECT role_code, scope_type, COUNT(*) AS count" +
		" FROM t_user_role WHERE deleted_at IS NULL GROUP BY role_code, scope_type"
	var bindingRows []roleBindingCount
	if err := db.WithContext(ctx).
		Raw(roleBindingsQuery).
		Scan(&bindingRows).Error; err != nil {
		return nil, nil, err
	}

	users := make([]userStatusCount, 0, len(userRows))
	for _, current := range userRows {
		tenant := current.Tenant
		if tenant == "" {
			tenant = "default"
		}
		users = append(users, userStatusCount{
			Status: userStatusLabel(current.Status),
			Tenant: tenant,
			Count:  current.Count,
		})
	}
	return users, bindingRows, nil
}

func userStatusLabel(status int32) string {
	switch status {
	case 0:
		return "inactive"
	case 1:
		return "active"
	case 2:
		return "freeze"
	default:
		return "unknown"
	}
}
