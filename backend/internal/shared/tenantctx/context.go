package tenantctx

import "context"

const OrganizationHeader = "X-Sico-Organization-ID"

type selectedOrganizationKey struct{}
type trustedInternalKey struct{}

func WithSelectedOrganization(ctx context.Context, organizationID int64) context.Context {
	return context.WithValue(ctx, selectedOrganizationKey{}, organizationID)
}

func SelectedOrganization(ctx context.Context) (int64, bool) {
	organizationID, ok := ctx.Value(selectedOrganizationKey{}).(int64)
	return organizationID, ok && organizationID > 0
}

func WithTrustedInternal(ctx context.Context) context.Context {
	return context.WithValue(ctx, trustedInternalKey{}, true)
}

func IsTrustedInternal(ctx context.Context) bool {
	trusted, _ := ctx.Value(trustedInternalKey{}).(bool)
	return trusted
}
