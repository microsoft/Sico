package impl

import (
	"context"
	"encoding/json"
	"errors"
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

type dashboardResourceEntry struct {
	item       map[string]interface{}
	sandboxID  string
	instanceID int64
}

func (s *Service) ListAllResourcesFiltered(
	ctx context.Context, filter *sandboxdto.ListSandboxResourcesFilter,
) (map[string]interface{}, error) {
	result, _, _, err := s.listResourcesFilteredWithBindings(ctx, filter, "", false)
	return result, err
}

func (s *Service) listResourcesFilteredWithBindings(
	ctx context.Context,
	filter *sandboxdto.ListSandboxResourcesFilter,
	typeFilter string,
	strict bool,
) (map[string]interface{}, map[string]int64, map[string]int64, error) {
	allTypes := enum.AllSandboxTypes()
	result := make(map[string]interface{}, len(allTypes))
	grouped := make(map[string][]*sandboxdto.SandboxResource, len(allTypes))
	for _, sandboxType := range allTypes {
		result[sandboxType] = []map[string]interface{}{}
		grouped[sandboxType] = []*sandboxdto.SandboxResource{}
	}

	listResult, err := s.Pool.ListResources(ctx, typeFilter)
	if err != nil {
		return nil, nil, nil, err
	}

	sandboxIDs := make([]string, 0, len(listResult.Resources))
	for _, resource := range listResult.Resources {
		if resource != nil {
			sandboxIDs = append(sandboxIDs, sandboxResourceID(resource))
		}
	}

	var orgBindings, projectBindings map[string]int64
	if strict {
		orgBindings, projectBindings, err = s.loadScopeBindingsStrict(ctx, sandboxIDs)
		if err != nil {
			return nil, nil, nil, err
		}
	} else {
		orgBindings, projectBindings = s.loadScopeBindings(ctx, listResult.Resources)
	}
	for _, resource := range listResult.Resources {
		if resource == nil {
			continue
		}
		sandboxID := sandboxResourceID(resource)
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

	return result, orgBindings, projectBindings, nil
}

func sandboxResourceID(resource *sandboxdto.SandboxResource) string {
	if resource.SandboxId != "" {
		return resource.SandboxId
	}

	return resource.Type + ":" + resource.ResourceId
}

func (s *Service) ListDashboardResourcesFiltered(
	ctx context.Context,
	filter *sandboxdto.ListSandboxResourcesFilter,
) (map[string]interface{}, error) {
	scopes, err := s.resolveSandboxAuthorizationScopes(ctx)
	if err != nil {
		return nil, err
	}

	return s.listDashboardResourcesForScopes(ctx, filter, "", scopes)
}

func (s *Service) listDashboardResourcesForScopes(
	ctx context.Context,
	filter *sandboxdto.ListSandboxResourcesFilter,
	typeFilter string,
	scopes *sandboxAuthorizationScopes,
) (map[string]interface{}, error) {
	result, orgBindings, projectBindings, err := s.listResourcesFilteredWithBindings(
		ctx,
		filter,
		typeFilter,
		true,
	)
	if err != nil {
		return nil, err
	}

	entries, instanceIDs := collectDashboardResourceEntries(result)
	if scopes.platform {
		return result, nil
	}
	instanceProjects, projectOrganizations, err := s.loadDashboardInstanceProjects(ctx, instanceIDs)
	if err != nil {
		return nil, err
	}

	for sandboxType, typeEntries := range entries {
		visible := make([]map[string]interface{}, 0, len(typeEntries))
		for _, entry := range typeEntries {
			if dashboardResourceVisible(
				entry,
				instanceProjects,
				projectOrganizations,
				orgBindings,
				projectBindings,
				scopes,
			) {
				visible = append(visible, entry.item)
			}
		}
		result[sandboxType] = visible
	}
	return result, nil
}

func dashboardResourceVisible(
	entry dashboardResourceEntry,
	instanceProjects, projectOrganizations map[int64]int64,
	orgBindings, projectBindings map[string]int64,
	scopes *sandboxAuthorizationScopes,
) bool {
	if entry.instanceID <= 0 {
		return scopes.orgIDs[orgBindings[entry.sandboxID]] ||
			scopes.projectIDs[projectBindings[entry.sandboxID]]
	}

	projectID, instanceExists := instanceProjects[entry.instanceID]
	if !instanceExists {
		return false
	}
	organizationID, projectExists := projectOrganizations[projectID]
	if !projectExists ||
		(projectBindings[entry.sandboxID] > 0 && projectBindings[entry.sandboxID] != projectID) ||
		(orgBindings[entry.sandboxID] > 0 && orgBindings[entry.sandboxID] != organizationID) {
		return false
	}
	return scopes.orgIDs[orgBindings[entry.sandboxID]] ||
		scopes.projectIDs[projectBindings[entry.sandboxID]] ||
		scopes.projectIDs[projectID] ||
		scopes.orgIDs[organizationID]
}

func isDashboardAccessDenied(err error) bool {
	appError, ok := apperr.As(err)
	return ok && appError.Code() == errcode.CommonForbidden
}

func int64Set(values []int64) map[int64]bool {
	result := make(map[int64]bool, len(values))
	for _, value := range values {
		if value > 0 {
			result[value] = true
		}
	}

	return result
}

func collectDashboardResourceEntries(
	result map[string]interface{},
) (map[string][]dashboardResourceEntry, []int64) {
	entries := make(map[string][]dashboardResourceEntry, len(result))
	instanceIDs := make([]int64, 0)
	seenInstanceIDs := map[int64]struct{}{}

	for sandboxType, rawItems := range result {
		items, ok := rawItems.([]map[string]interface{})
		if !ok {
			continue
		}
		for _, item := range items {
			sandboxID, _ := item["sandbox_id"].(string)
			instanceID, _ := strconv.ParseInt(getDashboardString(item, "instance_id"), 10, 64)
			entries[sandboxType] = append(entries[sandboxType], dashboardResourceEntry{
				item: item, sandboxID: sandboxID, instanceID: instanceID,
			})
			if instanceID > 0 {
				if _, seen := seenInstanceIDs[instanceID]; !seen {
					seenInstanceIDs[instanceID] = struct{}{}
					instanceIDs = append(instanceIDs, instanceID)
				}
			}
		}
	}
	return entries, instanceIDs
}

func getDashboardString(item map[string]interface{}, key string) string {
	value, _ := item[key].(string)
	return strings.TrimSpace(value)
}

func (s *Service) loadScopeBindingsStrict(
	ctx context.Context,
	sandboxIDs []string,
) (map[string]int64, map[string]int64, error) {
	orgBindings := make(map[string]int64, len(sandboxIDs))
	projectBindings := make(map[string]int64, len(sandboxIDs))
	if len(sandboxIDs) == 0 {
		return orgBindings, projectBindings, nil
	}
	if s == nil || s.Pool == nil || s.Pool.GetRedis() == nil {
		return nil, nil, apperr.New(errcode.CommonUnavailable, "sandbox storage unavailable")
	}

	pipe := s.Pool.GetRedis().Pipeline()
	orgCommands := make([]*redis.StringCmd, len(sandboxIDs))
	projectCommands := make([]*redis.StringCmd, len(sandboxIDs))
	for index, sandboxID := range sandboxIDs {
		orgCommands[index] = pipe.Get(ctx, orgAssignKey(sandboxID))
		projectCommands[index] = pipe.Get(ctx, projectAssignKey(sandboxID))
	}
	if _, err := pipe.Exec(ctx); err != nil && !errors.Is(err, redis.Nil) {
		return nil, nil, err
	}
	for index, sandboxID := range sandboxIDs {
		orgID, err := strictScopeBinding(orgCommands[index])
		if err != nil {
			return nil, nil, fmt.Errorf("read organization binding for %s: %w", sandboxID, err)
		}
		projectID, err := strictScopeBinding(projectCommands[index])
		if err != nil {
			return nil, nil, fmt.Errorf("read project binding for %s: %w", sandboxID, err)
		}
		orgBindings[sandboxID] = orgID
		projectBindings[sandboxID] = projectID
	}
	return orgBindings, projectBindings, nil
}

func strictScopeBinding(command *redis.StringCmd) (int64, error) {
	value, err := command.Result()
	if errors.Is(err, redis.Nil) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	if value == "" {
		return 0, nil
	}
	id, err := strconv.ParseInt(value, 10, 64)
	if err != nil || id <= 0 {
		return 0, fmt.Errorf("invalid scope ID %q", value)
	}
	return id, nil
}

func (s *Service) loadDashboardInstanceProjects(
	ctx context.Context,
	instanceIDs []int64,
) (map[int64]int64, map[int64]int64, error) {
	result := make(map[int64]int64, len(instanceIDs))
	projectOrganizations := map[int64]int64{}
	if len(instanceIDs) == 0 {
		return result, projectOrganizations, nil
	}
	if s.InstanceRepo == nil {
		return nil, nil, apperr.New(errcode.CommonUnavailable, "instance repository unavailable")
	}

	instances, err := s.InstanceRepo.MGet(ctx, instanceIDs)
	if err != nil {
		return nil, nil, err
	}

	projectIDs := make([]int64, 0, len(instances))
	seenProjects := map[int64]struct{}{}
	for _, instance := range instances {
		if instance != nil && instance.SingleAgentInstance != nil && instance.ProjectId > 0 {
			result[instance.Id] = instance.ProjectId
			if _, seen := seenProjects[instance.ProjectId]; !seen {
				seenProjects[instance.ProjectId] = struct{}{}
				projectIDs = append(projectIDs, instance.ProjectId)
			}
		}
	}
	if len(projectIDs) == 0 {
		return result, projectOrganizations, nil
	}
	if s.ProjectRepo == nil {
		return nil, nil, apperr.New(errcode.CommonUnavailable, "project repository unavailable")
	}
	projects, err := s.ProjectRepo.GetProjectByIDs(ctx, projectIDs)
	if err != nil {
		return nil, nil, err
	}
	for _, project := range projects {
		if project != nil && project.OrganizationID > 0 {
			projectOrganizations[project.ID] = project.OrganizationID
		}
	}
	return result, projectOrganizations, nil
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
	sandboxIDs, err := s.validateSandboxIDsExist(ctx, sandboxIDs)
	if err != nil {
		return err
	}

	rds := s.Pool.rds
	reverseKey := orgSandboxesKey(orgID)
	watchKeys := make([]string, 0, len(sandboxIDs)+1)
	for _, sandboxID := range sandboxIDs {
		watchKeys = append(watchKeys, orgAssignKey(sandboxID))
	}
	watchKeys = append(watchKeys, reverseKey)
	err = s.runLockedScopeMutation(ctx, rds, sandboxIDs, watchKeys, func(tx *redis.Tx) error {
		if err := requireRedisKeyType(ctx, tx, reverseKey, "set"); err != nil {
			return err
		}
		for _, sandboxID := range sandboxIDs {
			existing, err := getOptionalString(ctx, tx, orgAssignKey(sandboxID))
			if err != nil {
				return err
			}
			if existing != "" {
				return apperr.New(errcode.SandboxAlreadyAssignedToOrg,
					fmt.Sprintf("sandbox %s already assigned to org %s", sandboxID, existing))
			}
		}
		_, err := tx.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
			for _, sandboxID := range sandboxIDs {
				pipe.Set(ctx, orgAssignKey(sandboxID), strconv.FormatInt(orgID, 10), 0)
				pipe.SAdd(ctx, orgSandboxesKey(orgID), sandboxID)
			}
			return nil
		})
		return err
	})
	if err != nil {
		return err
	}
	logger.CtxInfo(ctx, "sandbox_org_assign orgID=%d count=%d", orgID, len(sandboxIDs))
	return nil
}

func (s *Service) ClaimUnassignedSandboxesForOrg(ctx context.Context, orgID int64) (int, error) {
	if orgID <= 0 {
		return 0, apperr.New(errcode.CommonInvalidParam, "organization ID must be positive")
	}

	resources, _, _, err := s.listResourcesFilteredWithBindings(ctx, nil, "", true)
	if err != nil {
		return 0, err
	}

	sandboxIDs := collectUnassignedSandboxIDs(resources)
	keys := make([]string, 0, len(sandboxIDs)+2)
	keys = append(keys, initialOrgClaimKey(), orgSandboxesKey(orgID))
	args := make([]interface{}, 0, len(sandboxIDs)+1)
	args = append(args, strconv.FormatInt(orgID, 10))
	for _, sandboxID := range sandboxIDs {
		keys = append(keys, orgAssignKey(sandboxID))
		args = append(args, sandboxID)
	}

	const claimScript = `
		if redis.call("EXISTS", KEYS[1]) == 1 then
			return 0
		end
		local assigned = 0
		for i = 3, #KEYS do
			if redis.call("EXISTS", KEYS[i]) == 0 then
				redis.call("SET", KEYS[i], ARGV[1])
				redis.call("SADD", KEYS[2], ARGV[i - 1])
				assigned = assigned + 1
			end
		end
		redis.call("SET", KEYS[1], ARGV[1])
		return assigned
	`
	assigned, err := s.Pool.rds.Eval(ctx, claimScript, keys, args...).Int()
	if err != nil {
		return 0, err
	}
	logger.CtxInfo(ctx, "sandbox_initial_org_claim orgID=%d count=%d", orgID, assigned)
	return assigned, nil
}

func collectUnassignedSandboxIDs(resources map[string]interface{}) []string {
	sandboxIDs := make([]string, 0)
	for _, value := range resources {
		items, ok := value.([]map[string]interface{})
		if !ok {
			continue
		}
		for _, item := range items {
			organizationID, _ := item["organization_id"].(int64)
			projectID, _ := item["project_id"].(int64)
			_, leased := item["instance_id"]
			sandboxID, _ := item["sandbox_id"].(string)
			if organizationID == 0 && projectID == 0 && !leased && sandboxID != "" {
				sandboxIDs = append(sandboxIDs, sandboxID)
			}
		}
	}
	sort.Strings(sandboxIDs)
	return sandboxIDs
}

func (s *Service) validateSandboxIDsExist(
	ctx context.Context,
	sandboxIDs []string,
) ([]string, error) {
	uniqueIDs, err := validateSandboxOperationBatch(sandboxIDs)
	if err != nil {
		return nil, err
	}
	if s == nil || s.Pool == nil {
		return nil, apperr.New(errcode.SandboxProviderUnavailable, "sandbox pool unavailable")
	}

	listResult, err := s.Pool.ListResources(ctx, "")
	if err != nil {
		return nil, err
	}
	available := make(map[string]struct{}, len(listResult.Resources))
	for _, resource := range listResult.Resources {
		if resource == nil {
			continue
		}
		sandboxID := resource.Type + ":" + resource.ResourceId
		if resource.SandboxId != "" {
			sandboxID = resource.SandboxId
		}
		available[sandboxID] = struct{}{}
	}
	for _, sandboxID := range uniqueIDs {
		if _, exists := available[sandboxID]; !exists {
			return nil, apperr.New(
				errcode.CommonNotFound,
				fmt.Sprintf("sandbox resource not found: %s", sandboxID),
			)
		}
	}
	return uniqueIDs, nil
}

func uniqueSandboxIDs(sandboxIDs []string) []string {
	result := make([]string, 0, len(sandboxIDs))
	seen := make(map[string]struct{}, len(sandboxIDs))

	for _, sandboxID := range sandboxIDs {
		sandboxID = strings.TrimSpace(sandboxID)
		if sandboxID == "" {
			continue
		}
		if _, exists := seen[sandboxID]; exists {
			continue
		}
		seen[sandboxID] = struct{}{}
		result = append(result, sandboxID)
	}
	return result
}

func validateSandboxOperationBatch(sandboxIDs []string) ([]string, error) {
	uniqueIDs := uniqueSandboxIDs(sandboxIDs)
	if len(uniqueIDs) == 0 {
		return nil, apperr.New(errcode.CommonInvalidParam, "sandbox IDs are required")
	}
	if len(uniqueIDs) > maxSandboxOperationLockBatch {
		return nil, apperr.New(
			errcode.CommonInvalidParam,
			fmt.Sprintf("at most %d sandbox IDs are allowed", maxSandboxOperationLockBatch),
		)
	}

	return uniqueIDs, nil
}

func runScopeMutation(
	ctx context.Context,
	rds *redis.Client,
	watchKeys []string,
	mutation func(*redis.Tx) error,
) error {
	for range 3 {
		err := rds.Watch(ctx, mutation, watchKeys...)
		if err == nil {
			return nil
		}
		if errors.Is(err, redis.TxFailedErr) {
			continue
		}
		return err
	}
	return apperr.New(errcode.CommonConflict, "sandbox scope changed concurrently")
}

func (s *Service) runLockedScopeMutation(
	ctx context.Context,
	rds *redis.Client,
	sandboxIDs, watchKeys []string,
	mutation func(*redis.Tx) error,
) error {
	return s.withSandboxOperationLocks(ctx, sandboxIDs, func() error {
		return runScopeMutation(ctx, rds, watchKeys, mutation)
	})
}

func getOptionalString(ctx context.Context, tx *redis.Tx, key string) (string, error) {
	value, err := tx.Get(ctx, key).Result()
	if errors.Is(err, redis.Nil) {
		return "", nil
	}

	return value, err
}

type redisKeyTyper interface {
	Type(ctx context.Context, key string) *redis.StatusCmd
}

func requireRedisKeyType(
	ctx context.Context,
	client redisKeyTyper,
	key, expected string,
) error {
	keyType, err := client.Type(ctx, key).Result()
	if err != nil {
		return err
	}

	if keyType != "none" && keyType != expected {
		return apperr.New(
			errcode.CommonInternalError,
			fmt.Sprintf("Redis key %s has type %s, expected %s", key, keyType, expected),
		)
	}
	return nil
}

func (s *Service) UnassignSandboxFromOrg(ctx context.Context, orgID int64, sandboxIDs []string) error {
	var err error
	sandboxIDs, err = validateSandboxOperationBatch(sandboxIDs)
	if err != nil {
		return err
	}

	rds := s.Pool.rds
	reverseKey := orgSandboxesKey(orgID)
	watchKeys := make([]string, 0, len(sandboxIDs)*2+1)
	for _, sandboxID := range sandboxIDs {
		watchKeys = append(watchKeys, orgAssignKey(sandboxID), projectAssignKey(sandboxID))
	}
	watchKeys = append(watchKeys, reverseKey)
	err = s.runLockedScopeMutation(ctx, rds, sandboxIDs, watchKeys, func(tx *redis.Tx) error {
		return unassignSandboxFromOrgTx(ctx, tx, orgID, sandboxIDs, reverseKey)
	})
	if err != nil {
		return err
	}
	logger.CtxInfo(ctx, "sandbox_org_unassign orgID=%d count=%d", orgID, len(sandboxIDs))
	return nil
}

func unassignSandboxFromOrgTx(
	ctx context.Context,
	tx *redis.Tx,
	orgID int64,
	sandboxIDs []string,
	reverseKey string,
) error {
	if err := requireRedisKeyType(ctx, tx, reverseKey, "set"); err != nil {
		return err
	}
	for _, sandboxID := range sandboxIDs {
		if err := validateOrgUnassignment(ctx, tx, orgID, sandboxID); err != nil {
			return err
		}
	}
	_, err := tx.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
		for _, sandboxID := range sandboxIDs {
			pipe.Del(ctx, orgAssignKey(sandboxID))
			pipe.SRem(ctx, reverseKey, sandboxID)
		}
		return nil
	})
	return err
}

func validateOrgUnassignment(
	ctx context.Context,
	tx *redis.Tx,
	orgID int64,
	sandboxID string,
) error {
	orgValue, err := getOptionalString(ctx, tx, orgAssignKey(sandboxID))
	if err != nil {
		return err
	}
	if orgValue != strconv.FormatInt(orgID, 10) {
		return apperr.New(
			errcode.SandboxProjectMismatch,
			fmt.Sprintf("sandbox %s is not assigned to org %d", sandboxID, orgID),
		)
	}
	projectValue, err := getOptionalString(ctx, tx, projectAssignKey(sandboxID))
	if err != nil {
		return err
	}
	if projectValue != "" {
		return apperr.New(
			errcode.SandboxHasProjectBindings,
			fmt.Sprintf("sandbox %s still has a project binding", sandboxID),
		)
	}
	return nil
}

func (s *Service) AssignSandboxToProject(ctx context.Context, projectID, orgID int64, sandboxIDs []string) error {
	var err error
	sandboxIDs, err = s.validateSandboxIDsExist(ctx, sandboxIDs)
	if err != nil {
		return err
	}

	project, err := s.getProject(ctx, projectID)
	if err != nil {
		return err
	}
	if orgID <= 0 || project.OrganizationID != orgID {
		return apperr.New(
			errcode.SandboxProjectMismatch,
			fmt.Sprintf("project %d belongs to org %d, not %d", projectID, project.OrganizationID, orgID),
		)
	}

	rds := s.Pool.rds
	reverseKey := projectSandboxesKey(projectID)
	watchKeys := make([]string, 0, len(sandboxIDs)*2+1)
	for _, sandboxID := range sandboxIDs {
		watchKeys = append(watchKeys, orgAssignKey(sandboxID), projectAssignKey(sandboxID))
	}
	watchKeys = append(watchKeys, reverseKey)
	err = s.runLockedScopeMutation(ctx, rds, sandboxIDs, watchKeys, func(tx *redis.Tx) error {
		return assignSandboxToProjectTx(ctx, tx, projectID, orgID, sandboxIDs, reverseKey)
	})
	if err != nil {
		return err
	}
	logger.CtxInfo(ctx, "sandbox_project_assign projectID=%d count=%d", projectID, len(sandboxIDs))
	return nil
}

func assignSandboxToProjectTx(
	ctx context.Context,
	tx *redis.Tx,
	projectID, orgID int64,
	sandboxIDs []string,
	reverseKey string,
) error {
	if err := requireRedisKeyType(ctx, tx, reverseKey, "set"); err != nil {
		return err
	}
	for _, sandboxID := range sandboxIDs {
		if err := validateProjectAssignment(ctx, tx, orgID, sandboxID); err != nil {
			return err
		}
	}
	_, err := tx.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
		for _, sandboxID := range sandboxIDs {
			pipe.Set(ctx, projectAssignKey(sandboxID), strconv.FormatInt(projectID, 10), 0)
			pipe.SAdd(ctx, reverseKey, sandboxID)
		}
		return nil
	})
	return err
}

func validateProjectAssignment(
	ctx context.Context,
	tx *redis.Tx,
	orgID int64,
	sandboxID string,
) error {
	orgValue, err := getOptionalString(ctx, tx, orgAssignKey(sandboxID))
	if err != nil {
		return err
	}
	if orgValue != strconv.FormatInt(orgID, 10) {
		return apperr.New(
			errcode.SandboxProjectMismatch,
			fmt.Sprintf("sandbox %s is not assigned to org %d", sandboxID, orgID),
		)
	}
	projectValue, err := getOptionalString(ctx, tx, projectAssignKey(sandboxID))
	if err != nil {
		return err
	}
	if projectValue != "" {
		return apperr.New(
			errcode.SandboxAlreadyAssignedToProject,
			fmt.Sprintf("sandbox %s already has a project binding", sandboxID),
		)
	}
	return nil
}

func (s *Service) UnassignSandboxFromProject(ctx context.Context, projectID int64, sandboxIDs []string) error {
	var err error
	sandboxIDs, err = validateSandboxOperationBatch(sandboxIDs)
	if err != nil {
		return err
	}

	rds := s.Pool.rds
	reverseKey := projectSandboxesKey(projectID)
	watchKeys := make([]string, 0, len(sandboxIDs)*2+1)
	for _, sandboxID := range sandboxIDs {
		watchKeys = append(watchKeys, projectAssignKey(sandboxID), resourceLeaseKey(sandboxID))
	}
	watchKeys = append(watchKeys, reverseKey)
	err = s.runLockedScopeMutation(ctx, rds, sandboxIDs, watchKeys, func(tx *redis.Tx) error {
		return unassignSandboxFromProjectTx(ctx, tx, projectID, sandboxIDs, reverseKey)
	})
	if err != nil {
		return err
	}
	logger.CtxInfo(ctx, "sandbox_project_unassign projectID=%d count=%d", projectID, len(sandboxIDs))
	return nil
}

func unassignSandboxFromProjectTx(
	ctx context.Context,
	tx *redis.Tx,
	projectID int64,
	sandboxIDs []string,
	reverseKey string,
) error {
	if err := requireRedisKeyType(ctx, tx, reverseKey, "set"); err != nil {
		return err
	}
	leases, err := loadProjectUnassignmentLeases(ctx, tx, projectID, sandboxIDs)
	if err != nil {
		return err
	}
	_, err = tx.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
		writeProjectUnassignment(ctx, pipe, sandboxIDs, leases, reverseKey)
		return nil
	})
	return err
}

func loadProjectUnassignmentLeases(
	ctx context.Context,
	tx *redis.Tx,
	projectID int64,
	sandboxIDs []string,
) (map[string]*Lease, error) {
	leases := make(map[string]*Lease, len(sandboxIDs))
	for _, sandboxID := range sandboxIDs {
		lease, err := loadProjectUnassignmentLease(ctx, tx, projectID, sandboxID)
		if err != nil {
			return nil, err
		}
		if lease != nil {
			leases[sandboxID] = lease
		}
	}
	return leases, nil
}

func loadProjectUnassignmentLease(
	ctx context.Context,
	tx *redis.Tx,
	projectID int64,
	sandboxID string,
) (*Lease, error) {
	projectValue, err := getOptionalString(ctx, tx, projectAssignKey(sandboxID))
	if err != nil {
		return nil, err
	}
	if projectValue != strconv.FormatInt(projectID, 10) {
		return nil, apperr.New(
			errcode.SandboxProjectMismatch,
			fmt.Sprintf("sandbox %s is not assigned to project %d", sandboxID, projectID),
		)
	}
	leaseValue, err := getOptionalString(ctx, tx, resourceLeaseKey(sandboxID))
	if err != nil || leaseValue == "" {
		return nil, err
	}
	var lease Lease
	if err := json.Unmarshal([]byte(leaseValue), &lease); err != nil {
		return nil, apperr.New(errcode.CommonInternalError, "failed to parse existing lease")
	}
	if lease.User != "" {
		if err := requireRedisKeyType(ctx, tx, assignKey(lease.User), "hash"); err != nil {
			return nil, err
		}
	}
	return &lease, nil
}

func writeProjectUnassignment(
	ctx context.Context,
	pipe redis.Pipeliner,
	sandboxIDs []string,
	leases map[string]*Lease,
	reverseKey string,
) {
	for _, sandboxID := range sandboxIDs {
		lease := leases[sandboxID]
		if lease != nil && lease.User != "" {
			pipe.HDel(ctx, assignKey(lease.User), sandboxID)
		}
		if lease != nil {
			pipe.Del(ctx, resourceLeaseKey(sandboxID))
			if lease.InUse {
				pipe.Set(ctx, cooldownKey(sandboxID), "1", releaseCooldown)
			}
		}
		pipe.Del(ctx, projectAssignKey(sandboxID))
		pipe.SRem(ctx, reverseKey, sandboxID)
	}
}

func (s *Service) GetSandboxOrgID(ctx context.Context, sandboxID string) (int64, error) {
	val, err := s.Pool.rds.Get(ctx, orgAssignKey(sandboxID)).Result()
	if errors.Is(err, redis.Nil) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	if val == "" {
		return 0, nil
	}

	return strconv.ParseInt(val, 10, 64)
}

func (s *Service) GetSandboxProjectID(ctx context.Context, sandboxID string) (int64, error) {
	val, err := s.Pool.rds.Get(ctx, projectAssignKey(sandboxID)).Result()
	if errors.Is(err, redis.Nil) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	if val == "" {
		return 0, nil
	}

	return strconv.ParseInt(val, 10, 64)
}
