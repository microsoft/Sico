package handler

import "sico-backend/internal/biz/rbac"

var access rbac.Access = rbac.NewUninitializedAccessServices()

// InitDependencies installs transport-only dependencies during application startup.
func InitDependencies(rbacAccess rbac.Access) {
	if rbacAccess != nil {
		access = rbacAccess
	}
}
