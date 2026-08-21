package impl

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"sico-backend/internal/errcode"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/enum"
	sandboxdto "sico-backend/internal/transport/http/dto/sandbox"
	"sico-backend/pkg/logger"
)

func (s *Service) ListAllResourcesFiltered(
	ctx context.Context, filter *sandboxdto.ListSandboxResourcesFilter,
) (map[string]interface{}, error) {
	allTypes := enum.AllSandboxTypes()
	result := make(map[string]interface{}, len(allTypes))
	grouped := make(map[string][]*sandboxdto.SandboxResource, len(allTypes))
	for _, sandboxType := range allTypes {
		result[sandboxType] = []map[string]interface{}{}
		grouped[sandboxType] = []*sandboxdto.SandboxResource{}
	}

	listResult, err := s.Pool.ListResources(ctx, "")
	if err != nil {
		return nil, err
	}

	orgBindings, projectBindings := s.loadScopeBindings(ctx, listResult.Resources)
	for _, resource := range listResult.Resources {
		if resource == nil {
			continue
		}
		sandboxID := resource.Type + ":" + resource.ResourceId
		if resource.SandboxId != "" {
			sandboxID = resource.SandboxId
		}
		if !matchesSandboxFilter(filter, sandboxID, orgBindings, projectBindings, listResult.Leases) {
			continue
		}
		if _, ok := grouped[resource.Type]; ok {
			grouped[resource.Type] = append(grouped[resource.Type], resource)
		}
	}

	displayNames := s.buildDisplayNameMap(listResult.Resources)
	now := time.Now()
	for _, sandboxType := range allTypes {
		resources := grouped[sandboxType]
		sort.Slice(resources, func(i, j int) bool {
			return strings.ToLower(resources[i].ResourceId) < strings.ToLower(resources[j].ResourceId)
		})

		list := make([]map[string]interface{}, 0, len(resources))
		for _, resource := range resources {
			info := s.buildResourceInfo(resource, listResult, displayNames, now)
			sandboxID, _ := info["sandbox_id"].(string)
			info["organization_id"] = orgBindings[sandboxID]
			info["project_id"] = projectBindings[sandboxID]
			list = append(list, info)
		}
		result[sandboxType] = list
	}

	return result, nil
}

func (s *Service) loadScopeBindings(
	ctx context.Context, resources []*sandboxdto.SandboxResource,
) (map[string]int64, map[string]int64) {
	orgBindings := make(map[string]int64, len(resources))
	projectBindings := make(map[string]int64, len(resources))
	rds := s.Pool.GetRedis()
	if rds == nil {
		return orgBindings, projectBindings
	}

	sandboxIDs := make([]string, 0, len(resources))
	pipe := rds.Pipeline()
	orgCommands := make([]*redis.StringCmd, 0, len(resources))
	projectCommands := make([]*redis.StringCmd, 0, len(resources))
	for _, resource := range resources {
		if resource == nil {
			continue
		}
		sandboxID := resource.Type + ":" + resource.ResourceId
		if resource.SandboxId != "" {
			sandboxID = resource.SandboxId
		}
		sandboxIDs = append(sandboxIDs, sandboxID)
		orgCommands = append(orgCommands, pipe.Get(ctx, orgAssignKey(sandboxID)))
		projectCommands = append(projectCommands, pipe.Get(ctx, projectAssignKey(sandboxID)))
	}
	_, _ = pipe.Exec(ctx)

	for index, sandboxID := range sandboxIDs {
		if value, err := orgCommands[index].Result(); err == nil {
			if id, parseErr := strconv.ParseInt(value, 10, 64); parseErr == nil {
				orgBindings[sandboxID] = id
			}
		}
		if value, err := projectCommands[index].Result(); err == nil {
			if id, parseErr := strconv.ParseInt(value, 10, 64); parseErr == nil {
				projectBindings[sandboxID] = id
			}
		}
	}
	return orgBindings, projectBindings
}

func matchesSandboxFilter(
	filter *sandboxdto.ListSandboxResourcesFilter,
	sandboxID string,
	orgBindings, projectBindings map[string]int64,
	leases map[string]*Lease,
) bool {
	if filter == nil {
		return true
	}
	if filter.OrganizationId != nil && orgBindings[sandboxID] != *filter.OrganizationId {
		return false
	}
	if filter.ProjectId != nil && projectBindings[sandboxID] != *filter.ProjectId {
		return false
	}
	if filter.InstanceId != nil {
		lease := leases[sandboxID]
		if lease == nil || lease.User != *filter.InstanceId {
			return false
		}
	}
	return true
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
		lease, err := s.Pool.GetSandboxByID(ctx, sid)
		if err != nil {
			if ae, ok := apperr.As(err); !ok || ae.Code() != errcode.SandboxLeaseNotFound {
				return err
			}
		}
		if lease != nil && lease.User != "" {
			if err := s.UnassignSandbox(ctx, lease.User, sid); err != nil {
				return err
			}
		}
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
