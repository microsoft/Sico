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
	ctx context.Context, req *dto.CreateOrganizationRequest,
) (*dto.CreateOrganizationResponse, error) {
	if err := rbac.CheckCtxAccess(ctx, rbac.ScopePlatform, 0, "organization", "admin"); err != nil {
		return nil, err
	}

	if _, err := s.OrgRepo.GetByName(ctx, req.Name); err == nil {
		return nil, apperr.New(errcode.CommonConflict, "organization name already exists")
	}

	org := &repo.OrganizationModel{
		Name:        req.Name,
		Description: req.Description,
	}
	if err := s.OrgRepo.Create(ctx, org); err != nil {
		logger.CtxError(ctx, "failed to create organization: name=%s, err=%v", req.Name, err)
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

func orgModelToDTO(m *repo.OrganizationModel) *dto.Organization {
	return &dto.Organization{
		Id:          m.ID,
		Name:        m.Name,
		Description: m.Description,
		CreatedAt:   m.CreatedAt,
		UpdatedAt:   m.UpdatedAt,
	}
}
