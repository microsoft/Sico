package organization

import (
	"context"

	dto "sico-backend/internal/transport/http/dto/organization"
)

// Service exposes organization-related business capabilities consumed by transports.
type Service interface {
	CreateOrganization(
		ctx context.Context, req *dto.CreateOrganizationRequest, creator string,
	) (*dto.CreateOrganizationResponse, error)
	UpdateOrganization(ctx context.Context, req *dto.UpdateOrganizationRequest) (*dto.UpdateOrganizationResponse, error)
	DeleteOrganization(ctx context.Context, req *dto.DeleteOrganizationRequest) (*dto.DeleteOrganizationResponse, error)
	GetOrganization(ctx context.Context, req *dto.GetOrganizationRequest) (*dto.GetOrganizationResponse, error)
	ListOrganizations(ctx context.Context, req *dto.ListOrganizationsRequest) (*dto.ListOrganizationsResponse, error)
	GetUserOrganizationList(
		ctx context.Context, req *dto.GetUserOrganizationListRequest,
	) (*dto.GetUserOrganizationListResponse, error)
}
