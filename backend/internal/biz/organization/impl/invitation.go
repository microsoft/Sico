package impl

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"time"

	"gorm.io/gorm"

	appresp "sico-backend/internal/biz/common/response"
	"sico-backend/internal/biz/rbac"
	"sico-backend/internal/errcode"
	"sico-backend/internal/shared/apperr"
	repo "sico-backend/internal/store/organization/repository"
	dto "sico-backend/internal/transport/http/dto/organization"
)

const (
	defaultInvitationExpirySeconds int64 = 7 * 24 * 60 * 60
	minimumInvitationExpirySeconds int64 = 60
	maximumInvitationExpirySeconds int64 = 30 * 24 * 60 * 60
)

func (s *Service) CreateOrganizationInvitation(
	ctx context.Context,
	req *dto.CreateOrganizationInvitationRequest,
	creator string,
) (*dto.CreateOrganizationInvitationResponse, error) {
	if req == nil || creator == "" {
		return nil, apperr.New(errcode.CommonInvalidParam, "request and creator are required")
	}
	if s.Ownership == nil || s.InvitationRepo == nil {
		return nil, apperr.New(errcode.CommonUnavailable, "organization invitation service unavailable")
	}

	organizationID, err := s.Ownership.RequireSelected(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.access().Require(ctx, rbac.OrganizationScope(organizationID), rbac.PermissionOrganizationManage); err != nil {
		return nil, err
	}

	expiresInSeconds := req.ExpiresInSeconds
	if expiresInSeconds == 0 {
		expiresInSeconds = defaultInvitationExpirySeconds
	}
	if expiresInSeconds < minimumInvitationExpirySeconds || expiresInSeconds > maximumInvitationExpirySeconds {
		return nil, apperr.New(errcode.CommonInvalidParam, "invitation expiry must be between 60 seconds and 30 days")
	}

	token, err := generateInvitationToken()
	if err != nil {
		return nil, err
	}
	now := time.Now()
	invitation := &repo.InvitationModel{
		OrganizationID:    organizationID,
		TokenHash:         hashInvitationToken(token),
		CreatedByUsername: creator,
		ExpiresAt:         now.Add(time.Duration(expiresInSeconds) * time.Second).UnixMilli(),
	}
	if err := s.InvitationRepo.Create(ctx, invitation); err != nil {
		return nil, err
	}

	return appresp.Success(&dto.CreateOrganizationInvitationResponse{
		Data: &dto.CreateOrganizationInvitationResponseData{
			Invitation: invitationModelToDTO(invitation),
			Token:      token,
		},
	}), nil
}

func (s *Service) GetOrganizationInvitation(
	ctx context.Context,
	req *dto.GetOrganizationInvitationRequest,
) (*dto.GetOrganizationInvitationResponse, error) {
	if req == nil || req.Token == "" {
		return nil, apperr.New(errcode.CommonInvalidParam, "invitation token is required")
	}

	invitation, err := s.getActiveInvitation(ctx, req.Token)
	if err != nil {
		return nil, err
	}
	organization, err := s.OrgRepo.GetByID(ctx, invitation.OrganizationID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, invitationNotFoundError()
		}
		return nil, err
	}
	organizationDTO := orgModelToDTO(organization)

	return appresp.Success(&dto.GetOrganizationInvitationResponse{
		Data: &dto.GetOrganizationInvitationResponseData{
			OrganizationId:      organization.ID,
			OrganizationName:    organization.Name,
			OrganizationIconUrl: organizationDTO.IconSasUrl,
			ExpiresAt:           invitation.ExpiresAt,
		},
	}), nil
}

func (s *Service) AcceptOrganizationInvitation(
	ctx context.Context,
	req *dto.AcceptOrganizationInvitationRequest,
	username string,
) (*dto.AcceptOrganizationInvitationResponse, error) {
	if req == nil || req.Token == "" || username == "" {
		return nil, apperr.New(errcode.CommonInvalidParam, "invitation token and username are required")
	}

	invitation, err := s.getActiveInvitation(ctx, req.Token)
	if err != nil {
		return nil, err
	}
	if _, err := s.OrgRepo.GetByID(ctx, invitation.OrganizationID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, invitationNotFoundError()
		}
		return nil, err
	}

	err = s.access().AssignOrganizationRole(ctx, username, rbac.RoleOrgMember, invitation.OrganizationID)
	if err != nil && !isRoleAlreadyAssigned(err) {
		return nil, err
	}

	return appresp.Success(&dto.AcceptOrganizationInvitationResponse{
		Data: &dto.AcceptOrganizationInvitationResponseData{OrganizationId: invitation.OrganizationID},
	}), nil
}

func (s *Service) ListOrganizationInvitations(
	ctx context.Context,
	req *dto.ListOrganizationInvitationsRequest,
) (*dto.ListOrganizationInvitationsResponse, error) {
	if req == nil || s.Ownership == nil || s.InvitationRepo == nil {
		return nil, apperr.New(errcode.CommonInvalidParam, "request is required")
	}

	organizationID, err := s.Ownership.RequireSelected(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.access().Require(ctx, rbac.OrganizationScope(organizationID), rbac.PermissionOrganizationManage); err != nil {
		return nil, err
	}
	page, pageSize := normalizedInvitationPage(req.Page, req.PageSize)
	models, total, err := s.InvitationRepo.ListByOrganization(ctx, organizationID, page, pageSize)
	if err != nil {
		return nil, err
	}

	invitations := make([]*dto.OrganizationInvitation, 0, len(models))
	for _, invitation := range models {
		invitations = append(invitations, invitationModelToDTO(invitation))
	}
	return appresp.Success(&dto.ListOrganizationInvitationsResponse{
		Data: &dto.ListOrganizationInvitationsResponseData{
			Invitations: invitations,
			Total:       int32(total),
			HasNext:     int64(page*pageSize) < total,
		},
	}), nil
}

func (s *Service) RevokeOrganizationInvitation(
	ctx context.Context,
	req *dto.RevokeOrganizationInvitationRequest,
) (*dto.RevokeOrganizationInvitationResponse, error) {
	if req == nil || req.Id <= 0 || s.Ownership == nil || s.InvitationRepo == nil {
		return nil, apperr.New(errcode.CommonInvalidParam, "invitation ID is required")
	}

	invitation, err := s.InvitationRepo.GetByID(ctx, req.Id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, invitationNotFoundError()
		}
		return nil, err
	}
	if err := s.Ownership.RequireOrganization(ctx, invitation.OrganizationID, false); err != nil {
		return nil, err
	}
	if err := s.access().Require(
		ctx, rbac.OrganizationScope(invitation.OrganizationID), rbac.PermissionOrganizationManage,
	); err != nil {
		return nil, err
	}
	if err := s.InvitationRepo.Revoke(ctx, req.Id, invitation.OrganizationID, time.Now().UnixMilli()); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, invitationNotFoundError()
		}
		return nil, err
	}

	return appresp.Success(&dto.RevokeOrganizationInvitationResponse{}), nil
}

func (s *Service) getActiveInvitation(ctx context.Context, token string) (*repo.InvitationModel, error) {
	if s.InvitationRepo == nil {
		return nil, apperr.New(errcode.CommonUnavailable, "organization invitation service unavailable")
	}
	invitation, err := s.InvitationRepo.GetByTokenHash(ctx, hashInvitationToken(token))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, invitationNotFoundError()
		}
		return nil, err
	}
	if invitation.RevokedAt != 0 || invitation.ExpiresAt <= time.Now().UnixMilli() {
		return nil, invitationNotFoundError()
	}
	return invitation, nil
}

func generateInvitationToken() (string, error) {
	randomBytes := make([]byte, 32)
	if _, err := rand.Read(randomBytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(randomBytes), nil
}

func hashInvitationToken(token string) string {
	digest := sha256.Sum256([]byte(token))
	return hex.EncodeToString(digest[:])
}

func invitationModelToDTO(invitation *repo.InvitationModel) *dto.OrganizationInvitation {
	result := &dto.OrganizationInvitation{
		Id:                invitation.ID,
		OrganizationId:    invitation.OrganizationID,
		CreatedByUsername: invitation.CreatedByUsername,
		ExpiresAt:         invitation.ExpiresAt,
		CreatedAt:         invitation.CreatedAt,
	}
	result.RevokedAt = invitation.RevokedAt
	return result
}

func normalizedInvitationPage(page, pageSize int32) (int32, int32) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 10
	}
	return page, pageSize
}

func invitationNotFoundError() error {
	return apperr.New(errcode.CommonNotFound, "organization invitation not found or expired")
}

func isRoleAlreadyAssigned(err error) bool {
	appError, ok := apperr.As(err)
	return ok && appError.Code() == errcode.RBACRoleAlreadyAssigned
}
