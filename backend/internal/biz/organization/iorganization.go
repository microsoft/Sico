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
	CreateOrganizationInternal(
		ctx context.Context, req *dto.CreateOrganizationRequest, creator string,
	) (*dto.CreateOrganizationResponse, error)
	UpdateOrganization(ctx context.Context, req *dto.UpdateOrganizationRequest) (*dto.UpdateOrganizationResponse, error)
	DeleteOrganization(ctx context.Context, req *dto.DeleteOrganizationRequest) (*dto.DeleteOrganizationResponse, error)
	GetOrganization(ctx context.Context, req *dto.GetOrganizationRequest) (*dto.GetOrganizationResponse, error)
	// ListOrganizations returns unfiltered platform inventory for trusted internal workflows.
	// User-facing handlers must use ListVisibleOrganizations.
	ListOrganizations(ctx context.Context, req *dto.ListOrganizationsRequest) (*dto.ListOrganizationsResponse, error)
	ListVisibleOrganizations(ctx context.Context, req *dto.ListOrganizationsRequest) (*dto.ListOrganizationsResponse, error)
	GetUserOrganizationList(
		ctx context.Context, req *dto.GetUserOrganizationListRequest,
	) (*dto.GetUserOrganizationListResponse, error)
	CreateOrganizationInvitation(
		ctx context.Context,
		req *dto.CreateOrganizationInvitationRequest,
		creator string,
	) (*dto.CreateOrganizationInvitationResponse, error)
	GetOrganizationInvitation(
		ctx context.Context,
		req *dto.GetOrganizationInvitationRequest,
	) (*dto.GetOrganizationInvitationResponse, error)
	AcceptOrganizationInvitation(
		ctx context.Context,
		req *dto.AcceptOrganizationInvitationRequest,
		username string,
	) (*dto.AcceptOrganizationInvitationResponse, error)
	ListOrganizationInvitations(
		ctx context.Context,
		req *dto.ListOrganizationInvitationsRequest,
	) (*dto.ListOrganizationInvitationsResponse, error)
	RevokeOrganizationInvitation(
		ctx context.Context,
		req *dto.RevokeOrganizationInvitationRequest,
	) (*dto.RevokeOrganizationInvitationResponse, error)
}
