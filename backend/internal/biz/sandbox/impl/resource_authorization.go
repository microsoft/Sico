package impl

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"gorm.io/gorm"

	"sico-backend/internal/biz/rbac"
	agententity "sico-backend/internal/entity/agent/singleagent"
	"sico-backend/internal/errcode"
	"sico-backend/internal/shared/apperr"
	projectrepo "sico-backend/internal/store/project/repository"
	"sico-backend/internal/transport/http/middleware"
)

type sandboxAuthorizationScopes struct {
	username   string
	platform   bool
	orgIDs     map[int64]bool
	projectIDs map[int64]bool
}

func (s *Service) resolveSandboxAuthorizationScopes(ctx context.Context) (*sandboxAuthorizationScopes, error) {
	user, authenticated := middleware.GetUserFromContext(ctx)
	if !authenticated {
		return nil, apperr.New(errcode.CommonUnauthorized, "authentication required")
	}
	access := s.access()
	if !access.Initialized() {
		return nil, apperr.New(errcode.CommonUnavailable, "RBAC service unavailable")
	}

	platformErr := access.Require(ctx, rbac.PlatformScope(), rbac.PermissionOrganizationAdmin)
	if platformErr == nil {
		return &sandboxAuthorizationScopes{username: user.Name, platform: true}, nil
	}
	if !isDashboardAccessDenied(platformErr) {
		return nil, platformErr
	}

	orgIDs, err := access.ListOrganizationIDs(ctx, rbac.PermissionOrganizationManage)
	if err != nil {
		return nil, err
	}
	projectIDs, err := s.access().GetProjectIDsByAdminUsername(ctx, user.Name)
	if err != nil {
		return nil, err
	}
	return &sandboxAuthorizationScopes{
		username:   user.Name,
		orgIDs:     int64Set(orgIDs),
		projectIDs: int64Set(projectIDs),
	}, nil
}

func (s *Service) AuthorizeResourceProxy(ctx context.Context, resource *Resource) error {
	if resource == nil {
		return apperr.New(errcode.CommonForbidden, "resource access denied")
	}
	sandboxID := strings.TrimSpace(resource.Type) + ":" + strings.TrimSpace(resource.ResourceID)
	return s.AuthorizeSandboxOperation(ctx, sandboxID, true)
}

func (s *Service) AuthorizeSandboxProviderOperation(ctx context.Context) error {
	scopes, err := s.resolveSandboxAuthorizationScopes(ctx)
	if err != nil {
		return err
	}
	if !scopes.platform {
		return apperr.New(errcode.CommonForbidden, "sandbox provider operation access denied")
	}
	return nil
}

func (s *Service) AuthorizeOrganizationSandboxAssign(ctx context.Context) error {
	return s.access().Require(ctx, rbac.PlatformScope(), rbac.PermissionOrganizationAdmin)
}

func (s *Service) AuthorizeOrganizationSandboxUnassign(ctx context.Context, organizationID int64) error {
	access := s.access()
	if err := access.Require(ctx, rbac.PlatformScope(), rbac.PermissionOrganizationAdmin); err == nil {
		return nil
	}
	return access.Require(ctx, rbac.OrganizationScope(organizationID), rbac.PermissionOrganizationManage)
}

func (s *Service) AuthorizeProjectSandboxAssignment(ctx context.Context, projectID int64) error {
	access := s.access()
	if !access.Initialized() {
		return apperr.New(errcode.CommonUnavailable, "RBAC service unavailable")
	}

	if err := access.Require(ctx, rbac.PlatformScope(), rbac.PermissionOrganizationAdmin); err == nil {
		return nil
	} else if appError, ok := apperr.As(err); !ok || appError.Code() != errcode.CommonForbidden {
		return err
	}

	username := middleware.MustGetUsernameFromCtx(ctx)
	projectIDs, err := access.GetProjectIDsByAdminUsername(ctx, username)
	if err != nil {
		return err
	}
	for _, allowedProjectID := range projectIDs {
		if allowedProjectID == projectID {
			return nil
		}
	}
	return apperr.New(errcode.CommonForbidden, "project administrator permission required")
}

func (s *Service) AuthorizeSandboxTypeDocs(ctx context.Context, sandboxType string) error {
	scopes, err := s.resolveSandboxAuthorizationScopes(ctx)
	if err != nil {
		return err
	}
	if scopes.platform {
		return nil
	}

	result, err := s.listDashboardResourcesForScopes(ctx, nil, sandboxType, scopes)
	if err != nil {
		return err
	}
	items, ok := result[sandboxType].([]map[string]interface{})
	if !ok || len(items) == 0 {
		return apperr.New(errcode.CommonForbidden, "sandbox documentation access denied")
	}
	return nil
}

func (s *Service) AuthorizeSandboxOperation(
	ctx context.Context,
	sandboxID string,
	allowOperator bool,
) error {
	if err := validateSandboxOperationID(sandboxID); err != nil {
		return err
	}
	scopes, err := s.resolveSandboxAuthorizationScopes(ctx)
	if err != nil {
		return err
	}

	return s.authorizeSandboxOperationForScopes(ctx, sandboxID, allowOperator, scopes)
}

func (s *Service) authorizeSandboxOperationForScopes(
	ctx context.Context,
	sandboxID string,
	allowOperator bool,
	scopes *sandboxAuthorizationScopes,
) error {
	if err := validateSandboxOperationID(sandboxID); err != nil {
		return err
	}
	if scopes == nil {
		return apperr.New(errcode.CommonUnavailable, "sandbox authorization scopes unavailable")
	}
	if scopes.platform {
		return nil
	}

	instance, project, err := s.loadSandboxAuthorizationTarget(ctx, sandboxID)
	if err != nil {
		return err
	}
	orgBindings, projectBindings, err := s.loadScopeBindingsStrict(ctx, []string{sandboxID})
	if err != nil {
		return err
	}
	if !sandboxAssignmentScopesConsistent(
		instance,
		project,
		orgBindings[sandboxID],
		projectBindings[sandboxID],
	) {
		return apperr.New(errcode.CommonForbidden, "sandbox assignment scopes are inconsistent")
	}
	if sandboxOperationAllowed(
		scopes,
		instance,
		project,
		orgBindings[sandboxID],
		projectBindings[sandboxID],
		allowOperator,
	) {
		return nil
	}
	return apperr.New(errcode.CommonForbidden, "resource access denied")
}

func (s *Service) loadSandboxAuthorizationTarget(
	ctx context.Context,
	sandboxID string,
) (*agententity.SingleAgentInstance, *projectrepo.ProjectModel, error) {
	lease, err := s.Pool.GetSandboxByID(ctx, sandboxID)
	if err != nil {
		if appError, ok := apperr.As(err); ok && appError.Code() == errcode.SandboxLeaseNotFound {
			return nil, nil, apperr.New(errcode.CommonForbidden, "unassigned resource access denied")
		}
		return nil, nil, err
	}
	instance, err := s.getInstanceByStringID(ctx, lease.User)
	if err != nil {
		return nil, nil, err
	}
	if instance.ProjectId <= 0 {
		return instance, nil, nil
	}
	project, err := s.getProject(ctx, instance.ProjectId)
	if err != nil {
		return nil, nil, err
	}
	return instance, project, nil
}

func sandboxOperationAllowed(
	scopes *sandboxAuthorizationScopes,
	instance *agententity.SingleAgentInstance,
	project *projectrepo.ProjectModel,
	boundOrgID, boundProjectID int64,
	allowOperator bool,
) bool {
	operatorAllowed := instanceOperatorAllowed(scopes, instance, allowOperator)
	if operatorAllowed {
		return true
	}
	if project == nil {
		return false
	}
	return scopes.orgIDs[boundOrgID] ||
		scopes.projectIDs[boundProjectID] ||
		scopes.projectIDs[instance.ProjectId] ||
		scopes.orgIDs[project.OrganizationID]
}

func sandboxAssignmentScopesConsistent(
	instance *agententity.SingleAgentInstance,
	project *projectrepo.ProjectModel,
	boundOrgID, boundProjectID int64,
) bool {
	if project == nil {
		return instance.ProjectId <= 0 && boundOrgID == 0 && boundProjectID == 0
	}
	return (boundProjectID == 0 || boundProjectID == instance.ProjectId) &&
		(boundOrgID == 0 || boundOrgID == project.OrganizationID)
}

func instanceOperatorAllowed(
	scopes *sandboxAuthorizationScopes,
	instance *agententity.SingleAgentInstance,
	allowOperator bool,
) bool {
	return allowOperator &&
		(scopes.username == instance.OperatorUsername || scopes.username == instance.EmployerUsername)
}

func validateSandboxOperationID(sandboxID string) error {
	parts := strings.SplitN(strings.TrimSpace(sandboxID), ":", 2)
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
		return apperr.New(errcode.CommonInvalidParam, "invalid sandbox ID")
	}

	return nil
}

func (s *Service) AuthorizeInstanceOperation(
	ctx context.Context,
	instanceID string,
	allowOperator bool,
) error {
	_, _, err := s.authorizeInstanceOperation(ctx, instanceID, allowOperator, false)
	return err
}

func (s *Service) AuthorizeSandboxAssignment(ctx context.Context, instanceID, sandboxID string) error {
	if err := validateSandboxOperationID(sandboxID); err != nil {
		return err
	}
	scopes, err := s.resolveSandboxAuthorizationScopes(ctx)
	if err != nil {
		return err
	}
	_, project, err := s.authorizeInstanceOperationForScopes(ctx, instanceID, false, true, scopes)
	if err != nil {
		return err
	}
	if scopes.platform {
		return nil
	}
	if _, err := s.Pool.GetSandboxByID(ctx, sandboxID); err == nil {
		return s.authorizeSandboxOperationForScopes(ctx, sandboxID, false, scopes)
	} else if !isSandboxLeaseNotFound(err) {
		return err
	}

	orgBindings, projectBindings, err := s.loadScopeBindingsStrict(ctx, []string{sandboxID})
	if err != nil {
		return err
	}
	if project == nil ||
		projectBindings[sandboxID] != project.ID ||
		orgBindings[sandboxID] != project.OrganizationID {
		return apperr.New(errcode.CommonForbidden, "sandbox and target instance scopes do not match")
	}
	return nil
}

func (s *Service) authorizeInstanceOperation(
	ctx context.Context,
	instanceID string,
	allowOperator bool,
	requireProject bool,
) (*agententity.SingleAgentInstance, *projectrepo.ProjectModel, error) {
	scopes, err := s.resolveSandboxAuthorizationScopes(ctx)
	if err != nil {
		return nil, nil, err
	}

	return s.authorizeInstanceOperationForScopes(ctx, instanceID, allowOperator, requireProject, scopes)
}

func (s *Service) authorizeInstanceOperationForScopes(
	ctx context.Context,
	instanceID string,
	allowOperator bool,
	requireProject bool,
	scopes *sandboxAuthorizationScopes,
) (*agententity.SingleAgentInstance, *projectrepo.ProjectModel, error) {
	if scopes == nil {
		return nil, nil, apperr.New(errcode.CommonUnavailable, "sandbox authorization scopes unavailable")
	}
	if scopes.platform && !requireProject {
		return nil, nil, nil
	}
	instance, err := s.getInstanceByStringID(ctx, instanceID)
	if err != nil {
		return nil, nil, err
	}

	operatorAllowed := instanceOperatorAllowed(scopes, instance, allowOperator)
	if instance.ProjectId <= 0 {
		return authorizeProjectlessInstance(instance, scopes, operatorAllowed)
	}
	projectAllowed := scopes.projectIDs[instance.ProjectId]
	if !requireProject && (operatorAllowed || projectAllowed) {
		return instance, nil, nil
	}
	project, err := s.getProject(ctx, instance.ProjectId)
	if err != nil {
		return nil, nil, err
	}
	if scopes.platform || operatorAllowed || projectAllowed ||
		scopes.orgIDs[project.OrganizationID] {
		return instance, project, nil
	}

	return nil, nil, apperr.New(errcode.CommonForbidden, "instance access denied")
}

func authorizeProjectlessInstance(
	instance *agententity.SingleAgentInstance,
	scopes *sandboxAuthorizationScopes,
	operatorAllowed bool,
) (*agententity.SingleAgentInstance, *projectrepo.ProjectModel, error) {
	if scopes.platform || operatorAllowed {
		return instance, nil, nil
	}
	return nil, nil, apperr.New(errcode.CommonForbidden, "instance access denied")
}

func (s *Service) FilterDashboardInstanceIDs(
	ctx context.Context,
	instanceIDs []int64,
) (map[int64]bool, error) {
	scopes, err := s.resolveSandboxAuthorizationScopes(ctx)
	if err != nil {
		return nil, err
	}

	allowed := make(map[int64]bool, len(instanceIDs))
	if scopes.platform {
		for _, instanceID := range instanceIDs {
			allowed[instanceID] = true
		}
		return allowed, nil
	}
	if len(instanceIDs) == 0 {
		return allowed, nil
	}
	if s.InstanceRepo == nil {
		return nil, apperr.New(errcode.CommonUnavailable, "instance repository unavailable")
	}
	instances, err := s.InstanceRepo.MGet(ctx, instanceIDs)
	if err != nil {
		return nil, err
	}

	projectIDs := collectDashboardProjectIDs(instances, scopes, allowed)
	if len(projectIDs) == 0 {
		return allowed, nil
	}

	allowedProjects, err := s.loadDashboardOrgProjects(ctx, projectIDs, scopes)
	if err != nil {
		return nil, err
	}
	for _, instance := range instances {
		if instance != nil && instance.SingleAgentInstance != nil && allowedProjects[instance.ProjectId] {
			allowed[instance.Id] = true
		}
	}

	return allowed, nil
}

func collectDashboardProjectIDs(
	instances []*agententity.SingleAgentInstance,
	scopes *sandboxAuthorizationScopes,
	allowed map[int64]bool,
) []int64 {
	projectIDs := make([]int64, 0, len(instances))
	seenProjects := map[int64]struct{}{}
	for _, instance := range instances {
		if instance == nil || instance.SingleAgentInstance == nil || instance.ProjectId <= 0 {
			continue
		}
		if scopes.projectIDs[instance.ProjectId] {
			allowed[instance.Id] = true
		}
		if _, seen := seenProjects[instance.ProjectId]; !seen {
			seenProjects[instance.ProjectId] = struct{}{}
			projectIDs = append(projectIDs, instance.ProjectId)
		}
	}
	return projectIDs
}

func (s *Service) loadDashboardOrgProjects(
	ctx context.Context,
	projectIDs []int64,
	scopes *sandboxAuthorizationScopes,
) (map[int64]bool, error) {
	if s.ProjectRepo == nil {
		return nil, apperr.New(errcode.CommonUnavailable, "project repository unavailable")
	}
	projects, err := s.ProjectRepo.GetProjectByIDs(ctx, projectIDs)
	if err != nil {
		return nil, err
	}
	allowedProjects := map[int64]bool{}
	for _, project := range projects {
		if project != nil && scopes.orgIDs[project.OrganizationID] {
			allowedProjects[project.ID] = true
		}
	}
	return allowedProjects, nil
}

func (s *Service) loadConsistentAssignedLeases(
	ctx context.Context,
	instanceID string,
	instance *agententity.SingleAgentInstance,
	project *projectrepo.ProjectModel,
) ([]*Lease, error) {
	leases, err := s.loadAssignedLeasesStrict(ctx, instanceID)
	if err != nil {
		return nil, err
	}
	if len(leases) == 0 {
		return []*Lease{}, nil
	}

	sandboxIDs := make([]string, 0, len(leases))
	for _, lease := range leases {
		if lease != nil {
			sandboxIDs = append(sandboxIDs, lease.SandboxID)
		}
	}
	orgBindings, projectBindings, err := s.loadScopeBindingsStrict(ctx, sandboxIDs)
	if err != nil {
		return nil, err
	}

	consistent := make([]*Lease, 0, len(leases))
	for _, lease := range leases {
		if lease == nil || strings.TrimSpace(lease.User) != strings.TrimSpace(instanceID) {
			continue
		}
		if !sandboxAssignmentScopesConsistent(
			instance,
			project,
			orgBindings[lease.SandboxID],
			projectBindings[lease.SandboxID],
		) {
			continue
		}
		consistent = append(consistent, lease)
	}
	return consistent, nil
}

func (s *Service) GetAuthorizedInstanceVNCURLs(
	ctx context.Context,
	instanceID string,
) ([]map[string]interface{}, error) {
	instance, project, err := s.authorizeInstanceOperation(ctx, instanceID, true, true)
	if err != nil {
		return nil, err
	}
	leases, err := s.loadConsistentAssignedLeases(ctx, instanceID, instance, project)
	if err != nil {
		return nil, err
	}

	result := make([]map[string]interface{}, 0, len(leases))
	for _, lease := range leases {
		_, _, vncURL, vncOpenURL := s.getSandboxEndpoints(lease)
		result = append(result, map[string]interface{}{
			"sandbox_id": lease.SandboxID, "type": lease.Type,
			"vnc_url": vncURL, "vnc_open_url": vncOpenURL,
		})
	}
	return result, nil
}

func (s *Service) GetAuthorizedInstanceSandboxesWithStatus(
	ctx context.Context,
	instanceID, osFilter string,
) ([]map[string]interface{}, error) {
	instance, project, err := s.authorizeInstanceOperation(ctx, instanceID, true, true)
	if err != nil {
		return nil, err
	}
	consistentLeases, err := s.loadConsistentAssignedLeases(ctx, instanceID, instance, project)
	if err != nil {
		return nil, err
	}

	return s.buildInstanceSandboxesWithStatus(ctx, instanceID, osFilter, consistentLeases)
}

func (s *Service) getInstanceByStringID(
	ctx context.Context,
	instanceID string,
) (*agententity.SingleAgentInstance, error) {
	instanceID = strings.TrimSpace(instanceID)
	if instanceID == "" {
		return nil, apperr.New(errcode.CommonInvalidParam, "instance ID is required")
	}

	parsedID, err := strconv.ParseInt(instanceID, 10, 64)
	if err != nil || parsedID <= 0 {
		return nil, apperr.New(errcode.CommonInvalidParam, "invalid instance ID")
	}

	if s.InstanceRepo == nil {
		return nil, apperr.New(errcode.CommonUnavailable, "instance repository unavailable")
	}
	instance, err := s.InstanceRepo.Get(ctx, parsedID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, apperr.New(errcode.CommonNotFound, "agent instance not found")
	}
	if err != nil {
		return nil, err
	}
	if instance == nil || instance.SingleAgentInstance == nil {
		return nil, apperr.New(errcode.CommonNotFound, "agent instance not found")
	}

	return instance, nil
}

func (s *Service) getProject(ctx context.Context, projectID int64) (*projectrepo.ProjectModel, error) {
	if projectID <= 0 {
		return nil, apperr.New(errcode.CommonForbidden, "project scope unavailable")
	}
	if s.ProjectRepo == nil {
		return nil, apperr.New(errcode.CommonUnavailable, "project repository unavailable")
	}

	project, err := s.ProjectRepo.GetProjectByID(ctx, projectID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, apperr.New(errcode.CommonNotFound, "project not found")
	}
	if err != nil {
		return nil, err
	}
	if project == nil {
		return nil, apperr.New(errcode.CommonNotFound, "project not found")
	}
	return project, nil
}
