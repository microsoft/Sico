package impl

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"sico-backend/internal/biz/ownership"
	"sico-backend/internal/biz/rbac"
	"sico-backend/internal/errcode"
	"sico-backend/internal/shared/apperr"
	repo "sico-backend/internal/store/organization/repository"
	dto "sico-backend/internal/transport/http/dto/organization"
)

type invitationRepository struct {
	repo.InvitationRepository
	created     *repo.InvitationModel
	invitations map[int64]*repo.InvitationModel
	revokedID   int64
}

func (r *invitationRepository) Create(_ context.Context, invitation *repo.InvitationModel) error {
	invitation.ID = 11
	invitation.CreatedAt = time.Now().UnixMilli()
	r.created = invitation
	return nil
}

func (r *invitationRepository) GetByID(_ context.Context, id int64) (*repo.InvitationModel, error) {
	invitation := r.invitations[id]
	if invitation == nil {
		return nil, gorm.ErrRecordNotFound
	}
	return invitation, nil
}

func (r *invitationRepository) GetByTokenHash(
	_ context.Context,
	tokenHash string,
) (*repo.InvitationModel, error) {
	for _, invitation := range r.invitations {
		if invitation.TokenHash == tokenHash {
			return invitation, nil
		}
	}
	return nil, gorm.ErrRecordNotFound
}

func (r *invitationRepository) Revoke(_ context.Context, id, organizationID, revokedAt int64) error {
	invitation := r.invitations[id]
	if invitation == nil || invitation.OrganizationID != organizationID {
		return gorm.ErrRecordNotFound
	}
	r.revokedID = id
	invitation.RevokedAt = revokedAt
	return nil
}

type invitationOrganizationRepository struct {
	repo.OrganizationRepository
	organizations map[int64]*repo.OrganizationModel
}

func (r *invitationOrganizationRepository) GetByID(
	_ context.Context,
	id int64,
) (*repo.OrganizationModel, error) {
	organization := r.organizations[id]
	if organization == nil {
		return nil, gorm.ErrRecordNotFound
	}
	return organization, nil
}

type invitationOwnership struct {
	ownership.Resolver
	selectedOrganizationID int64
	requiredOrganizationID int64
}

func (o *invitationOwnership) RequireSelected(context.Context) (int64, error) {
	return o.selectedOrganizationID, nil
}

func (o *invitationOwnership) RequireOrganization(
	_ context.Context,
	organizationID int64,
	_ bool,
) error {
	o.requiredOrganizationID = organizationID
	if organizationID != o.selectedOrganizationID {
		return apperr.New(errcode.CommonNotFound, "resource not found")
	}
	return nil
}

type invitationAccess struct {
	rbac.Access
	assignedUsername       string
	assignedRole           string
	assignedOrganizationID int64
	assignErr              error
}

func (a *invitationAccess) Require(context.Context, rbac.Scope, rbac.Permission) error {
	return nil
}

func (a *invitationAccess) AssignOrganizationRole(
	_ context.Context,
	username, roleCode string,
	organizationID int64,
) error {
	a.assignedUsername = username
	a.assignedRole = roleCode
	a.assignedOrganizationID = organizationID
	return a.assignErr
}

func TestCreateOrganizationInvitationStoresOnlyTokenHash(t *testing.T) {
	invitationRepo := &invitationRepository{}
	service := NewService(&Components{
		InvitationRepo: invitationRepo,
		Ownership:      &invitationOwnership{selectedOrganizationID: 42},
		Access:         &invitationAccess{},
	})

	before := time.Now().Add(6*24*time.Hour + 23*time.Hour).UnixMilli()
	response, err := service.CreateOrganizationInvitation(
		context.Background(), &dto.CreateOrganizationInvitationRequest{}, "admin@example.com",
	)
	after := time.Now().Add(7*24*time.Hour + time.Minute).UnixMilli()

	require.NoError(t, err)
	require.NotNil(t, invitationRepo.created)
	require.NotEmpty(t, response.Data.Token)
	assert.Equal(t, hashInvitationToken(response.Data.Token), invitationRepo.created.TokenHash)
	assert.NotEqual(t, response.Data.Token, invitationRepo.created.TokenHash)
	assert.Equal(t, int64(42), invitationRepo.created.OrganizationID)
	assert.Equal(t, "admin@example.com", invitationRepo.created.CreatedByUsername)
	assert.Greater(t, invitationRepo.created.ExpiresAt, before)
	assert.Less(t, invitationRepo.created.ExpiresAt, after)
}

func TestGetOrganizationInvitationRejectsExpiredToken(t *testing.T) {
	token := "expired-token"
	service := NewService(&Components{
		InvitationRepo: &invitationRepository{invitations: map[int64]*repo.InvitationModel{
			11: {ID: 11, TokenHash: hashInvitationToken(token), ExpiresAt: time.Now().Add(-time.Minute).UnixMilli()},
		}},
	})

	_, err := service.GetOrganizationInvitation(
		context.Background(), &dto.GetOrganizationInvitationRequest{Token: token},
	)

	require.Error(t, err)
	appError, ok := apperr.As(err)
	require.True(t, ok)
	assert.Equal(t, errcode.CommonNotFound, appError.Code())
}

func TestAcceptOrganizationInvitationIsIdempotentForExistingMember(t *testing.T) {
	token := "active-token"
	access := &invitationAccess{
		assignErr: apperr.New(errcode.RBACRoleAlreadyAssigned, "role already assigned to user"),
	}
	service := NewService(&Components{
		InvitationRepo: &invitationRepository{invitations: map[int64]*repo.InvitationModel{
			11: {
				ID: 11, OrganizationID: 42, TokenHash: hashInvitationToken(token),
				ExpiresAt: time.Now().Add(time.Hour).UnixMilli(),
			},
		}},
		OrgRepo: &invitationOrganizationRepository{organizations: map[int64]*repo.OrganizationModel{
			42: {ID: 42, Name: "Example Organization"},
		}},
		Access: access,
	})

	response, err := service.AcceptOrganizationInvitation(
		context.Background(), &dto.AcceptOrganizationInvitationRequest{Token: token}, "member@example.com",
	)

	require.NoError(t, err)
	assert.Equal(t, int64(42), response.Data.OrganizationId)
	assert.Equal(t, "member@example.com", access.assignedUsername)
	assert.Equal(t, rbac.RoleOrgMember, access.assignedRole)
	assert.Equal(t, int64(42), access.assignedOrganizationID)
}

func TestRevokeOrganizationInvitationUsesSelectedOrganization(t *testing.T) {
	invitationRepo := &invitationRepository{invitations: map[int64]*repo.InvitationModel{
		11: {ID: 11, OrganizationID: 42},
	}}
	ownershipResolver := &invitationOwnership{selectedOrganizationID: 42}
	service := NewService(&Components{
		InvitationRepo: invitationRepo,
		Ownership:      ownershipResolver,
		Access:         &invitationAccess{},
	})

	_, err := service.RevokeOrganizationInvitation(
		context.Background(), &dto.RevokeOrganizationInvitationRequest{Id: 11},
	)

	require.NoError(t, err)
	assert.Equal(t, int64(42), ownershipResolver.requiredOrganizationID)
	assert.Equal(t, int64(11), invitationRepo.revokedID)
}
