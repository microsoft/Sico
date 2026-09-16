package ownership

import (
	"context"

	"sico-backend/internal/shared/tenantctx"
)

func SelectedOrganization(ctx context.Context) (int64, bool) {
	return tenantctx.SelectedOrganization(ctx)
}
