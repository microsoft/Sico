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
	"fmt"
	"strconv"

	"sico-backend/internal/errcode"
	"sico-backend/internal/shared/apperr"
	sandboxdto "sico-backend/internal/transport/http/dto/sandbox"
	"sico-backend/pkg/logger"
)

const (
	sandboxOrgAssignKeyPrefix     = "sandbox:org-assign:"
	sandboxProjectAssignKeyPrefix = "sandbox:project-assign:"
	sandboxOrgSandboxesKeyPrefix  = "sandbox:org-sandboxes:"
	sandboxProjectSandboxesPrefix = "sandbox:project-sandboxes:"
)

func orgAssignKey(sandboxID string) string     { return sandboxOrgAssignKeyPrefix + sandboxID }
func projectAssignKey(sandboxID string) string { return sandboxProjectAssignKeyPrefix + sandboxID }
func orgSandboxesKey(orgID int64) string {
	return sandboxOrgSandboxesKeyPrefix + strconv.FormatInt(orgID, 10)
}
func projectSandboxesKey(projectID int64) string {
	return sandboxProjectSandboxesPrefix + strconv.FormatInt(projectID, 10)
}

func (s *Service) ListAllResourcesFiltered(
	ctx context.Context, filter *sandboxdto.ListSandboxResourcesFilter,
) (map[string]interface{}, error) {
	// Delegate to the unfiltered implementation for now; filtering can be
	// layered on top once the sandbox pool exposes org/project metadata.
	return s.ListAllResources(ctx)
}

func (s *Service) AssignSandboxToOrg(ctx context.Context, orgID int64, sandboxIDs []string) error {
	rds := s.Pool.rds
	for _, sid := range sandboxIDs {
		existing, _ := rds.Get(ctx, orgAssignKey(sid)).Result()
		if existing != "" {
			return apperr.New(errcode.SandboxAlreadyAssignedToOrg,
				fmt.Sprintf("sandbox %s already assigned to org %s", sid, existing))
		}
		if err := rds.Set(ctx, orgAssignKey(sid), strconv.FormatInt(orgID, 10), 0).Err(); err != nil {
			return err
		}
		if err := rds.SAdd(ctx, orgSandboxesKey(orgID), sid).Err(); err != nil {
			return err
		}
	}
	logger.CtxInfo(ctx, "sandbox_org_assign orgID=%d count=%d", orgID, len(sandboxIDs))
	return nil
}

func (s *Service) UnassignSandboxFromOrg(ctx context.Context, orgID int64, sandboxIDs []string) error {
	rds := s.Pool.rds
	for _, sid := range sandboxIDs {
		projVal, _ := rds.Get(ctx, projectAssignKey(sid)).Result()
		if projVal != "" {
			return apperr.New(errcode.SandboxHasProjectBindings,
				fmt.Sprintf("sandbox %s still assigned to project %s", sid, projVal))
		}
		rds.Del(ctx, orgAssignKey(sid))
		rds.SRem(ctx, orgSandboxesKey(orgID), sid)
	}
	logger.CtxInfo(ctx, "sandbox_org_unassign orgID=%d count=%d", orgID, len(sandboxIDs))
	return nil
}

func (s *Service) AssignSandboxToProject(ctx context.Context, projectID, orgID int64, sandboxIDs []string) error {
	rds := s.Pool.rds
	for _, sid := range sandboxIDs {
		existingOrg, _ := rds.Get(ctx, orgAssignKey(sid)).Result()
		if existingOrg == "" {
			return apperr.New(errcode.SandboxNotInOrg,
				fmt.Sprintf("sandbox %s not assigned to any org", sid))
		}
		if existingOrg != strconv.FormatInt(orgID, 10) {
			return apperr.New(errcode.SandboxProjectMismatch,
				fmt.Sprintf("sandbox %s belongs to org %s, not %d", sid, existingOrg, orgID))
		}
		existing, _ := rds.Get(ctx, projectAssignKey(sid)).Result()
		if existing != "" {
			return apperr.New(errcode.SandboxAlreadyAssignedToProject,
				fmt.Sprintf("sandbox %s already assigned to project %s", sid, existing))
		}
		if err := rds.Set(ctx, projectAssignKey(sid), strconv.FormatInt(projectID, 10), 0).Err(); err != nil {
			return err
		}
		if err := rds.SAdd(ctx, projectSandboxesKey(projectID), sid).Err(); err != nil {
			return err
		}
	}
	logger.CtxInfo(ctx, "sandbox_project_assign projectID=%d count=%d", projectID, len(sandboxIDs))
	return nil
}

func (s *Service) UnassignSandboxFromProject(ctx context.Context, projectID int64, sandboxIDs []string) error {
	rds := s.Pool.rds
	for _, sid := range sandboxIDs {
		rds.Del(ctx, projectAssignKey(sid))
		rds.SRem(ctx, projectSandboxesKey(projectID), sid)
	}
	logger.CtxInfo(ctx, "sandbox_project_unassign projectID=%d count=%d", projectID, len(sandboxIDs))
	return nil
}

func (s *Service) GetSandboxOrgID(ctx context.Context, sandboxID string) (int64, error) {
	val, err := s.Pool.rds.Get(ctx, orgAssignKey(sandboxID)).Result()
	if err != nil || val == "" {
		return 0, nil
	}
	return strconv.ParseInt(val, 10, 64)
}

func (s *Service) GetSandboxProjectID(ctx context.Context, sandboxID string) (int64, error) {
	val, err := s.Pool.rds.Get(ctx, projectAssignKey(sandboxID)).Result()
	if err != nil || val == "" {
		return 0, nil
	}
	return strconv.ParseInt(val, 10, 64)
}
