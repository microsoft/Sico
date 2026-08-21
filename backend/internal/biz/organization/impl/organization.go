package impl

import (
	"context"
	"errors"

	"gorm.io/gorm"

	appresp "sico-backend/internal/biz/common/response"
	rbac "sico-backend/internal/biz/rbac"
	"sico-backend/internal/errcode"
	"sico-backend/internal/shared/apperr"
	repo "sico-backend/internal/store/organization/repository"
	dto "sico-backend/internal/transport/http/dto/organization"
	"sico-backend/pkg/logger"
)

type Components struct {
	OrgRepo repo.OrganizationRepository
}

type Service struct {
	*Components
}

func NewService(c *Components) *Service {
	return &Service{Components: c}
}

func (s *Service) CreateOrganization(
	ctx context.Context, req *dto.CreateOrganizationRequest, creator string,
) (*dto.CreateOrganizationResponse, error) {
	if req == nil || creator == "" {
		return nil, apperr.New(errcode.CommonInvalidParam, "request and creator are required")
	}

	if err := rbac.CheckCtxAccess(ctx, rbac.ScopePlatform, 0, "organization", "admin"); err != nil {
		return nil, err
	}

	if _, err := s.OrgRepo.GetByName(ctx, req.Name); err == nil {
		return nil, apperr.New(errcode.CommonConflict, "organization name already exists")
	}

	org := &repo.OrganizationModel{
		Name:            req.Name,
		Description:     req.Description,
		CreatorUsername: creator,
	}
	if err := s.OrgRepo.Create(ctx, org); err != nil {
		logger.CtxError(ctx, "failed to create organization: name=%s, err=%v", req.Name, err)
		return nil, err
	}
	if err := rbac.AssignOrganizationRole(ctx, creator, rbac.RoleOrgMember, org.ID); err != nil {
		logger.CtxError(
			ctx,
			"failed to assign organization member role to creator: organizationId=%d, creator=%s, err=%v",
			org.ID, creator, err,
		)
		if deleteErr := s.OrgRepo.Delete(ctx, org.ID); deleteErr != nil {
			logger.CtxError(ctx, "failed to roll back organization after RBAC failure: organizationId=%d, err=%v",
				org.ID, deleteErr)
		}
		return nil, err
	}
	if err := rbac.AssignOrganizationRole(ctx, creator, rbac.RoleOrgAdmin, org.ID); err != nil {
		logger.CtxError(ctx, "failed to assign organization admin role to creator: organizationId=%d, creator=%s, err=%v",
			org.ID, creator, err)
		if removeErr := rbac.RemoveAllOrganizationRoles(ctx, org.ID); removeErr != nil {
			logger.CtxError(
				ctx, "failed to roll back organization roles: organizationId=%d, err=%v", org.ID, removeErr,
			)
		}
		if deleteErr := s.OrgRepo.Delete(ctx, org.ID); deleteErr != nil {
			logger.CtxError(ctx, "failed to roll back organization after RBAC failure: organizationId=%d, err=%v",
				org.ID, deleteErr)
		}
		return nil, err
	}

	return appresp.Success(&dto.CreateOrganizationResponse{
		Data: &dto.CreateOrganizationResponseData{Id: org.ID},
	}), nil
}

func (s *Service) UpdateOrganization(
	ctx context.Context, req *dto.UpdateOrganizationRequest,
) (*dto.UpdateOrganizationResponse, error) {
	if err := rbac.CheckCtxAccess(ctx, rbac.ScopeOrg, req.Id, "organization", "manage"); err != nil {
		return nil, err
	}

	existing, err := s.OrgRepo.GetByID(ctx, req.Id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperr.New(errcode.CommonNotFound, "organization not found")
		}
		return nil, err
	}

	if req.Name != "" {
		existing.Name = req.Name
	}
	if req.Description != "" {
		existing.Description = req.Description
	}

	if err := s.OrgRepo.Update(ctx, existing); err != nil {
		logger.CtxError(ctx, "failed to update organization: id=%d, err=%v", req.Id, err)
		return nil, err
	}

	return appresp.Success(&dto.UpdateOrganizationResponse{}), nil
}

func (s *Service) DeleteOrganization(
	ctx context.Context, req *dto.DeleteOrganizationRequest,
) (*dto.DeleteOrganizationResponse, error) {
	if err := rbac.CheckCtxAccess(ctx, rbac.ScopePlatform, 0, "organization", "admin"); err != nil {
		return nil, err
	}

	if _, err := s.OrgRepo.GetByID(ctx, req.Id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperr.New(errcode.CommonNotFound, "organization not found")
		}
		return nil, err
	}

	if err := s.OrgRepo.Delete(ctx, req.Id); err != nil {
		logger.CtxError(ctx, "failed to delete organization: id=%d, err=%v", req.Id, err)
		return nil, err
	}
	if err := rbac.RemoveAllOrganizationRoles(ctx, req.Id); err != nil {
		logger.CtxError(ctx, "failed to remove organization roles: organizationId=%d, err=%v", req.Id, err)
		return nil, err
	}

	return appresp.Success(&dto.DeleteOrganizationResponse{}), nil
}

func (s *Service) GetOrganization(
	ctx context.Context, req *dto.GetOrganizationRequest,
) (*dto.GetOrganizationResponse, error) {
	org, err := s.OrgRepo.GetByID(ctx, req.Id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperr.New(errcode.CommonNotFound, "organization not found")
		}
		return nil, err
	}

	return appresp.Success(&dto.GetOrganizationResponse{
		Data: &dto.GetOrganizationResponseData{
			Organization: orgModelToDTO(org),
		},
	}), nil
}

func (s *Service) ListOrganizations(
	ctx context.Context, req *dto.ListOrganizationsRequest,
) (*dto.ListOrganizationsResponse, error) {
	list, total, err := s.OrgRepo.List(ctx, req.Name, req.Page, req.PageSize)
	if err != nil {
		logger.CtxError(ctx, "failed to list organizations: err=%v", err)
		return nil, err
	}

	orgs := make([]*dto.Organization, 0, len(list))
	for _, org := range list {
		orgs = append(orgs, orgModelToDTO(org))
	}

	hasNext := int64(req.Page*req.PageSize) < total
	return appresp.Success(&dto.ListOrganizationsResponse{
		Data: &dto.ListOrganizationsResponseData{
			Organizations: orgs,
			Total:         int32(total),
			HasNext:       hasNext,
		},
	}), nil
}

func (s *Service) GetUserOrganizationList(
	ctx context.Context, req *dto.GetUserOrganizationListRequest,
) (*dto.GetUserOrganizationListResponse, error) {
	if req == nil || req.Username == "" {
		return nil, apperr.New(errcode.CommonInvalidParam, "request and username are required")
	}

	page := req.Page
	if page <= 0 {
		page = 1
	}
	pageSize := req.PageSize
	if pageSize <= 0 {
		pageSize = 10
	}

	memberships, err := rbac.GetUserOrganizationListByUsername(ctx, req.Username, req.RoleCode)
	if err != nil {
		logger.CtxError(ctx, "failed to get user organization list: username=%s, err=%v", req.Username, err)
		return nil, err
	}

	organizationIDs := make([]int64, 0, len(memberships))
	for _, membership := range memberships {
		organizationIDs = append(organizationIDs, membership.OrganizationID)
	}
	organizations, err := s.OrgRepo.GetByIDs(ctx, organizationIDs)
	if err != nil {
		logger.CtxError(ctx, "failed to get organizations by IDs: ids=%v, err=%v", organizationIDs, err)
		return nil, err
	}
	organizationByID := make(map[int64]*repo.OrganizationModel, len(organizations))
	for _, organization := range organizations {
		organizationByID[organization.ID] = organization
	}

	memberships = filterExistingOrganizationMemberships(memberships, organizationByID)
	total := len(memberships)
	start := min(int((page-1)*pageSize), total)
	end := min(start+int(pageSize), total)
	pagedMemberships := memberships[start:end]

	result := make([]*dto.Organization, 0, len(pagedMemberships))
	for _, membership := range pagedMemberships {
		organization := organizationByID[membership.OrganizationID]
		item := orgModelToDTO(organization)
		item.RoleCodes = membership.RoleCodes
		item.IsOwner = organization.CreatorUsername == req.Username
		result = append(result, item)
	}

	return appresp.Success(&dto.GetUserOrganizationListResponse{
		Data: &dto.GetUserOrganizationListResponseData{
			Organizations: result,
			Total:         int32(total),
			HasNext:       end < total,
		},
	}), nil
}

func filterExistingOrganizationMemberships(
	memberships []rbac.OrganizationMembership,
	organizationByID map[int64]*repo.OrganizationModel,
) []rbac.OrganizationMembership {
	filtered := make([]rbac.OrganizationMembership, 0, len(memberships))
	for _, membership := range memberships {
		if organizationByID[membership.OrganizationID] != nil {
			filtered = append(filtered, membership)
		}
	}
	return filtered
}

func orgModelToDTO(m *repo.OrganizationModel) *dto.Organization {
	return &dto.Organization{
		Id:              m.ID,
		Name:            m.Name,
		Description:     m.Description,
		CreatorUsername: m.CreatorUsername,
		CreatedAt:       m.CreatedAt,
		UpdatedAt:       m.UpdatedAt,
	}
}
