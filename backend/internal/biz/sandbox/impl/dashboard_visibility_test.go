package impl

import (
	"context"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/casbin/casbin/v2"
	casbinmodel "github.com/casbin/casbin/v2/model"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"

	"sico-backend/internal/biz/rbac"
	agententity "sico-backend/internal/entity/agent/singleagent"
	"sico-backend/internal/shared/enum"
	agentrepo "sico-backend/internal/store/agent/singleagent/repository"
	projectrepo "sico-backend/internal/store/project/repository"
	rolerepo "sico-backend/internal/store/rbac/repository"
	agentdto "sico-backend/internal/transport/http/dto/agent/single_agent"
	sandboxdto "sico-backend/internal/transport/http/dto/sandbox"
	"sico-backend/internal/transport/http/middleware"
)

type dashboardInstanceRepo struct {
	agentrepo.SingleAgentInstanceRepository
	instances map[int64]*agententity.SingleAgentInstance
	err       error
	getCalls  int
	mgetCalls int
}

type operationBlocker struct {
	started     chan struct{}
	proceed     chan struct{}
	startedOnce sync.Once
	proceedOnce sync.Once
}

func newOperationBlocker(t *testing.T) *operationBlocker {
	t.Helper()
	blocker := &operationBlocker{started: make(chan struct{}), proceed: make(chan struct{})}
	t.Cleanup(blocker.release)
	return blocker
}

func (b *operationBlocker) block() {
	b.startedOnce.Do(func() { close(b.started) })
	<-b.proceed
}

func (b *operationBlocker) release() {
	b.proceedOnce.Do(func() { close(b.proceed) })
}

func waitForTestSignal(t *testing.T, signal <-chan struct{}, failureMessage string) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(2 * time.Second):
		t.Fatal(failureMessage)
	}
}

func sandboxLockContentionContext(
	parent context.Context,
	sandboxID string,
) (context.Context, <-chan struct{}) {
	contended := make(chan struct{}, 1)
	ctx := context.WithValue(
		parent,
		sandboxOperationLockTestHookKey{},
		func(stage, observedSandboxID string) {
			if stage != sandboxOperationLockStageContended || observedSandboxID != sandboxID {
				return
			}
			select {
			case contended <- struct{}{}:
			default:
			}
		},
	)
	return ctx, contended
}

func (r *dashboardInstanceRepo) Get(
	_ context.Context,
	id int64,
) (*agententity.SingleAgentInstance, error) {
	r.getCalls++
	if r.err != nil {
		return nil, r.err
	}
	return r.instances[id], nil
}

func (r *dashboardInstanceRepo) MGet(
	_ context.Context,
	ids []int64,
) ([]*agententity.SingleAgentInstance, error) {
	r.mgetCalls++
	if r.err != nil {
		return nil, r.err
	}
	result := make([]*agententity.SingleAgentInstance, 0, len(ids))
	for _, id := range ids {
		if instance := r.instances[id]; instance != nil {
			result = append(result, instance)
		}
	}
	return result, nil
}

type dashboardProjectRepo struct {
	projectrepo.ProjectRepository
	projects map[int64]*projectrepo.ProjectModel
	err      error
}

func (r *dashboardProjectRepo) GetProjectByID(
	_ context.Context,
	id int64,
) (*projectrepo.ProjectModel, error) {
	if r.err != nil {
		return nil, r.err
	}
	return r.projects[id], nil
}

func (r *dashboardProjectRepo) GetProjectByIDs(
	_ context.Context,
	ids []int64,
) ([]*projectrepo.ProjectModel, error) {
	if r.err != nil {
		return nil, r.err
	}
	result := make([]*projectrepo.ProjectModel, 0, len(ids))
	for _, id := range ids {
		if project := r.projects[id]; project != nil {
			result = append(result, project)
		}
	}
	return result, nil
}

func configureAssignmentScope(
	t *testing.T,
	ctx context.Context,
	client *redis.Client,
	service *Service,
	sandboxID string,
	instanceIDs ...int64,
) {
	t.Helper()
	require.NoError(t, client.Set(ctx, orgAssignKey(sandboxID), "9", 0).Err())
	require.NoError(t, client.Set(ctx, projectAssignKey(sandboxID), "7", 0).Err())
	instances := make(map[int64]*agententity.SingleAgentInstance, len(instanceIDs))
	for _, instanceID := range instanceIDs {
		instances[instanceID] = &agententity.SingleAgentInstance{SingleAgentInstance: &agentdto.SingleAgentInstance{
			Id: instanceID, ProjectId: 7,
		}}
	}
	service.InstanceRepo = &dashboardInstanceRepo{instances: instances}
	service.ProjectRepo = &dashboardProjectRepo{projects: map[int64]*projectrepo.ProjectModel{
		7: {ID: 7, OrganizationID: 9},
	}}
}

type dashboardUserRepo struct {
	rolerepo.UserRepository
	users map[string]*rolerepo.UserModel
}

func (r *dashboardUserRepo) GetUserByUsername(
	_ context.Context,
	username string,
) (*rolerepo.UserModel, error) {
	return r.users[username], nil
}

type dashboardUserRoleRepo struct {
	rolerepo.UserRoleRepository
	roles []*rolerepo.UserRoleModel
}

func (r *dashboardUserRoleRepo) List(
	_ context.Context,
	filter *rolerepo.UserRoleFilter,
) ([]*rolerepo.UserRoleModel, int64, error) {
	result := make([]*rolerepo.UserRoleModel, 0)
	for _, role := range r.roles {
		if filter.UserID > 0 && role.UserID != filter.UserID {
			continue
		}
		if filter.RoleCode != "" && role.RoleCode != filter.RoleCode {
			continue
		}
		if filter.ScopeType != "" && role.ScopeType != filter.ScopeType {
			continue
		}
		if filter.ScopeID != "" && filter.ScopeID != "0" && role.ScopeID != filter.ScopeID {
			continue
		}
		result = append(result, role)
	}
	return result, int64(len(result)), nil
}

func newDashboardCasbinEnforcer(t *testing.T) *casbin.Enforcer {
	t.Helper()
	model, err := casbinmodel.NewModelFromString(`
[request_definition]
r = sub, dom, obj, act
[policy_definition]
p = sub, dom, obj, act
[role_definition]
g = _, _, _
[policy_effect]
e = some(where (p.eft == allow))
[matchers]
m = g(r.sub, p.sub, r.dom) && (r.dom == p.dom || p.dom == "*") && r.obj == p.obj && r.act == p.act
`)
	require.NoError(t, err)
	enforcer, err := casbin.NewEnforcer(model)
	require.NoError(t, err)
	for _, policy := range [][]string{
		{rbac.RolePlatformAdmin, "*", "organization", "admin"},
		{rbac.RoleOrgAdmin, "*", "organization", "manage"},
		{rbac.RoleProjectAdmin, "*", "project", "manage"},
		{rbac.RoleProjectMember, "*", "project", "manage"},
		{rbac.RoleProjectMember, "*", "dw", "use"},
	} {
		_, err = enforcer.AddPolicy(policy)
		require.NoError(t, err)
	}
	for _, grouping := range [][]string{
		{"platform@example.com", rbac.RolePlatformAdmin, rbac.ScopePlatform},
		{"org9@example.com", rbac.RoleOrgAdmin, "org:9"},
		{"project7@example.com", rbac.RoleProjectAdmin, "project:7"},
		{"member7@example.com", rbac.RoleProjectMember, "project:7"},
		{"project8@example.com", rbac.RoleProjectAdmin, "project:8"},
	} {
		_, err = enforcer.AddGroupingPolicy(grouping)
		require.NoError(t, err)
	}
	return enforcer
}

func TestListDashboardResourcesPermissionMatrix(t *testing.T) {
	ctx := context.Background()
	miniRedis := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: miniRedis.Addr()})
	t.Cleanup(func() { require.NoError(t, client.Close()) })

	users := map[string]*rolerepo.UserModel{}
	for index, username := range []string{
		"platform@example.com",
		"org9@example.com",
		"project7@example.com",
		"member7@example.com",
		"project8@example.com",
		"operator@example.com",
		"employer@example.com",
		"no-access@example.com",
	} {
		users[username] = &rolerepo.UserModel{ID: int64(index + 1), Username: username}
	}
	roleRepo := &dashboardUserRoleRepo{roles: []*rolerepo.UserRoleModel{
		{UserID: users["org9@example.com"].ID, RoleCode: rbac.RoleOrgAdmin, ScopeType: rbac.ScopeOrg, ScopeID: "9"},
		{
			UserID: users["project7@example.com"].ID, RoleCode: rbac.RoleProjectAdmin,
			ScopeType: rbac.ScopeProject, ScopeID: "7",
		},
		{
			UserID: users["member7@example.com"].ID, RoleCode: rbac.RoleProjectMember,
			ScopeType: rbac.ScopeProject, ScopeID: "7",
		},
		{
			UserID: users["project8@example.com"].ID, RoleCode: rbac.RoleProjectAdmin,
			ScopeType: rbac.ScopeProject, ScopeID: "8",
		},
	}}
	access := rbac.NewAccessServices(
		&dashboardUserRepo{users: users}, roleRepo, newDashboardCasbinEnforcer(t), nil,
	)

	resourceDirect := testEmulatorResource(ResourceStatusAvailable)
	resourceOwner := testEmulatorResource(ResourceStatusAvailable)
	resourceOwner.ResourceID = "http://74.179.80.110:8000|4"
	resourceOwner.Metadata["adbPort"] = "16481"
	resource8 := testEmulatorResource(ResourceStatusAvailable)
	resource8.ResourceID = "http://74.179.80.110:8000|5"
	resource8.Metadata["adbPort"] = "16482"
	missingInstance := testEmulatorResource(ResourceStatusAvailable)
	missingInstance.ResourceID = "http://74.179.80.110:8000|6"
	missingInstance.Metadata["adbPort"] = "16483"
	unassigned := testEmulatorResource(ResourceStatusAvailable)
	unassigned.ResourceID = "http://74.179.80.110:8000|7"
	unassigned.Metadata["adbPort"] = "16484"
	seedSnapshot(
		t,
		ctx,
		client,
		resourceDirect.Type,
		time.Now(),
		resourceDirect,
		resourceOwner,
		resource8,
		missingInstance,
		unassigned,
	)

	leaseDirect := testEmulatorLease()
	leaseDirect.User = "101"
	leaseOwner := testEmulatorLease()
	leaseOwner.SandboxID = "emulator:" + resourceOwner.ResourceID
	leaseOwner.ResourceID = resourceOwner.ResourceID
	leaseOwner.User = "102"
	lease8 := testEmulatorLease()
	lease8.SandboxID = "emulator:" + resource8.ResourceID
	lease8.ResourceID = resource8.ResourceID
	lease8.User = "103"
	leaseMissing := testEmulatorLease()
	leaseMissing.SandboxID = "emulator:" + missingInstance.ResourceID
	leaseMissing.ResourceID = missingInstance.ResourceID
	leaseMissing.User = "104"
	seedLease(t, ctx, client, leaseDirect)
	seedLease(t, ctx, client, leaseOwner)
	seedLease(t, ctx, client, lease8)
	seedLease(t, ctx, client, leaseMissing)

	for sandboxID, scopes := range map[string][2]int64{
		leaseDirect.SandboxID:               {9, 7},
		leaseOwner.SandboxID:                {9, 0},
		lease8.SandboxID:                    {10, 8},
		leaseMissing.SandboxID:              {9, 7},
		"emulator:" + unassigned.ResourceID: {9, 7},
	} {
		require.NoError(t, client.Set(ctx, orgAssignKey(sandboxID), strconv.FormatInt(scopes[0], 10), 0).Err())
		if scopes[1] > 0 {
			require.NoError(t, client.Set(
				ctx,
				projectAssignKey(sandboxID),
				strconv.FormatInt(scopes[1], 10),
				0,
			).Err())
		}
	}

	instanceRepo := &dashboardInstanceRepo{instances: map[int64]*agententity.SingleAgentInstance{
		101: {SingleAgentInstance: &agentdto.SingleAgentInstance{
			Id: 101, ProjectId: 7, OperatorUsername: "operator@example.com", EmployerUsername: "employer@example.com",
		}},
		102: {SingleAgentInstance: &agentdto.SingleAgentInstance{Id: 102, ProjectId: 7}},
		103: {SingleAgentInstance: &agentdto.SingleAgentInstance{Id: 103, ProjectId: 8}},
	}}
	provider := &fakeEmulatorAppProvider{}
	service := &Service{
		Pool:         newTestPool(client, provider, time.Minute),
		InstanceRepo: instanceRepo,
		Access:       access,
		ProjectRepo: &dashboardProjectRepo{projects: map[int64]*projectrepo.ProjectModel{
			7: {ID: 7, OrganizationID: 9},
			8: {ID: 8, OrganizationID: 10},
		}},
	}

	tests := []struct {
		name     string
		username string
		wantIDs  []string
		wantMGet int
	}{
		{
			name: "platform admin sees all including unassigned", username: "platform@example.com",
			wantIDs: []string{
				leaseDirect.SandboxID, leaseOwner.SandboxID, lease8.SandboxID,
				leaseMissing.SandboxID, "emulator:" + unassigned.ResourceID,
			},
		},
		{
			name: "organization admin sees its valid leased and unleased scope", username: "org9@example.com",
			wantIDs: []string{
				leaseDirect.SandboxID, leaseOwner.SandboxID, "emulator:" + unassigned.ResourceID,
			},
			wantMGet: 1,
		},
		{
			name: "project admin sees leased and unleased project paths", username: "project7@example.com",
			wantIDs: []string{
				leaseDirect.SandboxID, leaseOwner.SandboxID, "emulator:" + unassigned.ResourceID,
			},
			wantMGet: 1,
		},
		{name: "project member sees nothing", username: "member7@example.com", wantMGet: 1},
		{
			name: "other project admin sees only its scope", username: "project8@example.com",
			wantIDs: []string{lease8.SandboxID}, wantMGet: 1,
		},
		{name: "instance operator does not gain Dashboard visibility", username: "operator@example.com", wantMGet: 1},
		{name: "instance employer does not gain Dashboard visibility", username: "employer@example.com", wantMGet: 1},
		{name: "user without an admin role sees nothing", username: "no-access@example.com", wantMGet: 1},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			instanceRepo.mgetCalls = 0
			requestContext := context.WithValue(
				ctx,
				middleware.ContextUserKey,
				middleware.UserInfo{Name: test.username},
			)
			if test.username == "member7@example.com" {
				require.NoError(t, service.access().Require(
					requestContext, rbac.ProjectScope(7), rbac.PermissionProjectManage,
				))
				require.NoError(t, service.access().Require(
					requestContext, rbac.ProjectScope(7), rbac.PermissionWorkspaceUse,
				))
			}

			result, err := service.ListDashboardResourcesFiltered(requestContext, nil)
			require.NoError(t, err)
			items, ok := result[resourceDirect.Type].([]map[string]interface{})
			require.True(t, ok)
			actualIDs := make([]string, 0, len(items))
			for _, item := range items {
				actualIDs = append(actualIDs, getDashboardString(item, "sandbox_id"))
			}
			require.ElementsMatch(t, test.wantIDs, actualIDs)
			require.Equal(t, test.wantMGet, instanceRepo.mgetCalls)
		})
	}

	t.Run("project filter includes unleased project sandbox", func(t *testing.T) {
		requestContext := context.WithValue(
			ctx,
			middleware.ContextUserKey,
			middleware.UserInfo{Name: "project7@example.com"},
		)
		projectID := int64(7)
		result, err := service.ListDashboardResourcesFiltered(
			requestContext,
			&sandboxdto.ListSandboxResourcesFilter{ProjectId: &projectID},
		)
		require.NoError(t, err)
		items := result[resourceDirect.Type].([]map[string]interface{})
		actualIDs := make([]string, 0, len(items))
		for _, item := range items {
			actualIDs = append(actualIDs, getDashboardString(item, "sandbox_id"))
		}
		require.ElementsMatch(t, []string{
			leaseDirect.SandboxID,
			"emulator:" + unassigned.ResourceID,
		}, actualIDs)
	})

	t.Run("instance repository errors fail closed", func(t *testing.T) {
		instanceRepo.err = context.DeadlineExceeded
		t.Cleanup(func() { instanceRepo.err = nil })
		requestContext := context.WithValue(
			ctx,
			middleware.ContextUserKey,
			middleware.UserInfo{Name: "project7@example.com"},
		)
		_, err := service.ListDashboardResourcesFiltered(requestContext, nil)
		require.ErrorIs(t, err, context.DeadlineExceeded)
		instanceRepo.err = nil
	})

	t.Run("malformed scope bindings fail closed", func(t *testing.T) {
		require.NoError(t, client.Set(ctx, projectAssignKey(leaseDirect.SandboxID), "invalid", 0).Err())
		t.Cleanup(func() {
			require.NoError(t, client.Set(ctx, projectAssignKey(leaseDirect.SandboxID), "7", 0).Err())
		})
		requestContext := context.WithValue(
			ctx,
			middleware.ContextUserKey,
			middleware.UserInfo{Name: "project7@example.com"},
		)
		projectID := int64(7)
		_, err := service.ListDashboardResourcesFiltered(
			requestContext,
			&sandboxdto.ListSandboxResourcesFilter{ProjectId: &projectID},
		)
		require.Error(t, err)
		require.Contains(t, err.Error(), "invalid scope ID")
	})

	t.Run("authorized instance views hide inconsistent leases", func(t *testing.T) {
		require.NoError(t, client.Set(ctx, projectAssignKey(leaseDirect.SandboxID), "8", 0).Err())
		t.Cleanup(func() {
			require.NoError(t, client.Set(ctx, projectAssignKey(leaseDirect.SandboxID), "7", 0).Err())
		})
		operatorContext := context.WithValue(
			ctx,
			middleware.ContextUserKey,
			middleware.UserInfo{Name: "operator@example.com"},
		)
		instanceRepo.getCalls = 0
		vncItems, err := service.GetAuthorizedInstanceVNCURLs(operatorContext, "101")
		require.NoError(t, err)
		require.Empty(t, vncItems)
		require.Equal(t, 1, instanceRepo.getCalls)
		instanceRepo.getCalls = 0
		sandboxItems, err := service.GetAuthorizedInstanceSandboxesWithStatus(
			operatorContext,
			"101",
			"",
		)
		require.NoError(t, err)
		require.Empty(t, sandboxItems)
		require.Equal(t, 1, instanceRepo.getCalls)
	})

	t.Run("single resource authorization follows the matrix", func(t *testing.T) {
		projectAdminContext := context.WithValue(
			ctx,
			middleware.ContextUserKey,
			middleware.UserInfo{Name: "project7@example.com"},
		)
		require.NoError(t, service.AuthorizeSandboxOperation(projectAdminContext, leaseDirect.SandboxID, false))
		err := service.AuthorizeSandboxOperation(
			projectAdminContext,
			"emulator:"+unassigned.ResourceID,
			false,
		)
		require.Error(t, err)
		require.True(t, isDashboardAccessDenied(err))

		operatorContext := context.WithValue(
			ctx,
			middleware.ContextUserKey,
			middleware.UserInfo{Name: "operator@example.com"},
		)
		require.NoError(t, service.AuthorizeSandboxOperation(operatorContext, leaseDirect.SandboxID, true))
		err = service.AuthorizeSandboxOperation(operatorContext, leaseDirect.SandboxID, false)
		require.Error(t, err)
		require.True(t, isDashboardAccessDenied(err))

		memberContext := context.WithValue(
			ctx,
			middleware.ContextUserKey,
			middleware.UserInfo{Name: "member7@example.com"},
		)
		err = service.AuthorizeSandboxOperation(memberContext, leaseDirect.SandboxID, true)
		require.Error(t, err)
		require.True(t, isDashboardAccessDenied(err))
		require.Error(t, service.AuthorizeProjectSandboxAssignment(memberContext, 7))
		require.NoError(t, service.AuthorizeProjectSandboxAssignment(projectAdminContext, 7))
		require.NoError(t, service.AuthorizeInstanceOperation(projectAdminContext, "101", false))
		require.Error(t, service.AuthorizeInstanceOperation(projectAdminContext, "103", false))
		require.NoError(t, service.AuthorizeSandboxTypeDocs(projectAdminContext, resourceDirect.Type))
		require.Error(t, service.AuthorizeSandboxTypeDocs(memberContext, resourceDirect.Type))
		require.Error(t, service.AuthorizeSandboxTypeDocs(
			projectAdminContext, enum.SandboxTypeLinuxWorkstation.String(),
		))
		require.NoError(t, service.AuthorizeSandboxProviderOperation(context.WithValue(
			ctx,
			middleware.ContextUserKey,
			middleware.UserInfo{Name: "platform@example.com"},
		)))
		require.Error(t, service.AuthorizeSandboxProviderOperation(projectAdminContext))
	})

	t.Run("sandbox assignment authorization accepts matching unleased scope", func(t *testing.T) {
		projectAdminContext := context.WithValue(
			ctx,
			middleware.ContextUserKey,
			middleware.UserInfo{Name: "project7@example.com"},
		)
		unleasedSandboxID := "emulator:" + unassigned.ResourceID
		require.NoError(t, service.AuthorizeSandboxAssignment(projectAdminContext, "101", unleasedSandboxID))
		require.NoError(t, service.AuthorizeSandboxAssignment(projectAdminContext, "102", leaseDirect.SandboxID))
		require.Error(t, service.AuthorizeSandboxAssignment(projectAdminContext, "103", unleasedSandboxID))
		require.Error(t, service.AuthorizeSandboxAssignment(projectAdminContext, "101", lease8.SandboxID))

		noAccessContext := context.WithValue(
			ctx,
			middleware.ContextUserKey,
			middleware.UserInfo{Name: "no-access@example.com"},
		)
		require.Error(t, service.AuthorizeSandboxAssignment(noAccessContext, "101", unleasedSandboxID))
	})

	t.Run("emulator app targets follow operation permissions", func(t *testing.T) {
		tests := []struct {
			username string
			wantIDs  []string
		}{
			{username: "platform@example.com", wantIDs: []string{
				leaseDirect.SandboxID, leaseOwner.SandboxID, lease8.SandboxID, leaseMissing.SandboxID,
				"emulator:" + unassigned.ResourceID,
			}},
			{username: "org9@example.com", wantIDs: []string{leaseDirect.SandboxID, leaseOwner.SandboxID}},
			{username: "project7@example.com", wantIDs: []string{leaseDirect.SandboxID, leaseOwner.SandboxID}},
			{username: "project8@example.com", wantIDs: []string{lease8.SandboxID}},
			{username: "operator@example.com", wantIDs: []string{leaseDirect.SandboxID}},
			{username: "employer@example.com", wantIDs: []string{leaseDirect.SandboxID}},
			{username: "member7@example.com"},
			{username: "no-access@example.com"},
		}
		for _, test := range tests {
			requestContext := context.WithValue(
				ctx,
				middleware.ContextUserKey,
				middleware.UserInfo{Name: test.username},
			)
			authorized, _, err := service.resolveEmulatorAppTargets(requestContext, nil, "", true)
			require.NoError(t, err)
			actualIDs := make([]string, 0, len(authorized))
			for _, target := range authorized {
				actualIDs = append(actualIDs, target.sandboxID)
			}
			require.ElementsMatch(t, test.wantIDs, actualIDs)
		}

		projectAdminContext := context.WithValue(
			ctx,
			middleware.ContextUserKey,
			middleware.UserInfo{Name: "project7@example.com"},
		)
		_, _, err := service.resolveEmulatorAppTargets(
			projectAdminContext,
			[]string{leaseDirect.SandboxID, lease8.SandboxID},
			"",
			true,
		)
		require.Error(t, err)
		require.True(t, isDashboardAccessDenied(err))

		operatorContext := context.WithValue(
			ctx,
			middleware.ContextUserKey,
			middleware.UserInfo{Name: "operator@example.com"},
		)
		resolved, _, err := service.resolveEmulatorAppTargets(operatorContext, nil, "101", false)
		require.NoError(t, err)
		require.Len(t, resolved, 1)
		require.Equal(t, leaseDirect.SandboxID, resolved[0].sandboxID)

		memberContext := context.WithValue(
			ctx,
			middleware.ContextUserKey,
			middleware.UserInfo{Name: "member7@example.com"},
		)
		_, _, err = service.resolveEmulatorAppTargets(memberContext, nil, "101", false)
		require.Error(t, err)
		require.True(t, isDashboardAccessDenied(err))
	})

	t.Run("projectless instance operator can use only unbound assignments", func(t *testing.T) {
		instance := instanceRepo.instances[101]
		originalProjectID := instance.ProjectId
		instance.ProjectId = 0
		t.Cleanup(func() { instance.ProjectId = originalProjectID })
		require.NoError(t, client.Del(
			ctx,
			orgAssignKey(leaseDirect.SandboxID),
			projectAssignKey(leaseDirect.SandboxID),
		).Err())
		t.Cleanup(func() {
			require.NoError(t, client.Set(ctx, orgAssignKey(leaseDirect.SandboxID), "9", 0).Err())
			require.NoError(t, client.Set(ctx, projectAssignKey(leaseDirect.SandboxID), "7", 0).Err())
		})

		operatorContext := context.WithValue(
			ctx,
			middleware.ContextUserKey,
			middleware.UserInfo{Name: "operator@example.com"},
		)
		require.NoError(t, service.AuthorizeSandboxOperation(operatorContext, leaseDirect.SandboxID, true))
		require.NoError(t, service.AuthorizeInstanceOperation(operatorContext, "101", true))
		vncItems, err := service.GetAuthorizedInstanceVNCURLs(operatorContext, "101")
		require.NoError(t, err)
		require.Len(t, vncItems, 1)
		sandboxItems, err := service.GetAuthorizedInstanceSandboxesWithStatus(operatorContext, "101", "")
		require.NoError(t, err)
		require.Len(t, sandboxItems, 1)
		targets, _, err := service.resolveEmulatorAppTargets(operatorContext, nil, "101", false)
		require.NoError(t, err)
		require.Len(t, targets, 1)

		projectAdminContext := context.WithValue(
			ctx,
			middleware.ContextUserKey,
			middleware.UserInfo{Name: "project7@example.com"},
		)
		require.Error(t, service.AuthorizeSandboxOperation(
			projectAdminContext,
			leaseDirect.SandboxID,
			true,
		))

		require.NoError(t, client.Set(ctx, orgAssignKey(leaseDirect.SandboxID), "9", 0).Err())
		require.Error(t, service.AuthorizeSandboxOperation(operatorContext, leaseDirect.SandboxID, true))
	})

	t.Run("instance dropdown follows admin scopes", func(t *testing.T) {
		projectAdminContext := context.WithValue(
			ctx,
			middleware.ContextUserKey,
			middleware.UserInfo{Name: "project7@example.com"},
		)
		allowed, err := service.FilterDashboardInstanceIDs(projectAdminContext, []int64{101, 102, 103})
		require.NoError(t, err)
		require.Equal(t, map[int64]bool{101: true, 102: true}, allowed)

		orgAdminContext := context.WithValue(
			ctx,
			middleware.ContextUserKey,
			middleware.UserInfo{Name: "org9@example.com"},
		)
		allowed, err = service.FilterDashboardInstanceIDs(orgAdminContext, []int64{101, 102, 103})
		require.NoError(t, err)
		require.Equal(t, map[int64]bool{101: true, 102: true}, allowed)
	})

	t.Run("emulator app mutation serializes reassignment", func(t *testing.T) {
		blocker := newOperationBlocker(t)
		provider.uninstallFn = func(
			context.Context,
			string,
			[]int,
			string,
			int32,
		) (*EmulatorAppBatchResponse, error) {
			blocker.block()
			return &EmulatorAppBatchResponse{Results: []EmulatorAppBatchDeviceResult{{
				Index: 3, Status: emulatorAppDeviceStatusUninstalled,
			}}}, nil
		}
		defer func() { provider.uninstallFn = nil }()
		operatorContext := context.WithValue(
			ctx,
			middleware.ContextUserKey,
			middleware.UserInfo{Name: "operator@example.com"},
		)
		operationDone := make(chan error, 1)
		go func() {
			_, err := service.UninstallEmulatorApp(operatorContext, &sandboxdto.EmulatorAppUninstallRequest{
				SandboxIds: []string{leaseDirect.SandboxID},
				Package:    "com.example.app",
			})
			operationDone <- err
		}()
		waitForTestSignal(t, blocker.started, "app operation did not start")
		require.Greater(
			t,
			client.TTL(ctx, sandboxOperationLockKey(leaseDirect.SandboxID)).Val(),
			emulatorAppMutationRunTimeout,
		)

		assignContext, assignWaiting := sandboxLockContentionContext(ctx, leaseDirect.SandboxID)
		assignDone := make(chan error, 1)
		go func() { assignDone <- service.AssignSandbox(assignContext, "102", leaseDirect.SandboxID) }()
		waitForTestSignal(t, assignWaiting, "reassignment did not contend on the app operation lock")
		blocker.release()
		require.NoError(t, <-operationDone)
		require.NoError(t, <-assignDone)
		require.NoError(t, service.AssignSandbox(ctx, "101", leaseDirect.SandboxID))
	})

	t.Run("admin release serializes with reset", func(t *testing.T) {
		leaseDirect.InUse = true
		seedLease(t, ctx, client, leaseDirect)
		blocker := newOperationBlocker(t)
		provider.resetFn = func(context.Context, string) error {
			blocker.block()
			return nil
		}
		defer func() { provider.resetFn = nil }()
		operatorContext := context.WithValue(
			ctx,
			middleware.ContextUserKey,
			middleware.UserInfo{Name: "operator@example.com"},
		)
		resetDone := make(chan error, 1)
		go func() { resetDone <- service.ResetAuthorizedSandbox(operatorContext, leaseDirect.SandboxID) }()
		waitForTestSignal(t, blocker.started, "reset did not start")

		projectAdminContext := context.WithValue(
			ctx,
			middleware.ContextUserKey,
			middleware.UserInfo{Name: "project7@example.com"},
		)
		releaseContext, releaseWaiting := sandboxLockContentionContext(
			projectAdminContext,
			leaseDirect.SandboxID,
		)
		releaseDone := make(chan error, 1)
		go func() {
			releaseDone <- service.ReleaseAuthorizedSandbox(releaseContext, "101", leaseDirect.SandboxID)
		}()
		waitForTestSignal(t, releaseWaiting, "release did not contend on the reset lock")
		blocker.release()
		require.NoError(t, <-resetDone)
		require.NoError(t, <-releaseDone)
		require.False(t, loadLease(t, ctx, client, leaseDirect.SandboxID).InUse)
	})

	t.Run("authorized reset serializes reassignment", func(t *testing.T) {
		blocker := newOperationBlocker(t)
		provider.resetFn = func(context.Context, string) error {
			blocker.block()
			return nil
		}
		defer func() { provider.resetFn = nil }()
		operatorContext := context.WithValue(
			ctx,
			middleware.ContextUserKey,
			middleware.UserInfo{Name: "operator@example.com"},
		)
		resetDone := make(chan error, 1)
		go func() { resetDone <- service.ResetAuthorizedSandbox(operatorContext, leaseDirect.SandboxID) }()
		waitForTestSignal(t, blocker.started, "reset did not start")

		assignDone := make(chan error, 1)
		assignContext, assignWaiting := sandboxLockContentionContext(ctx, leaseDirect.SandboxID)
		go func() { assignDone <- service.AssignSandbox(assignContext, "102", leaseDirect.SandboxID) }()
		waitForTestSignal(t, assignWaiting, "reassignment did not contend on the reset lock")
		blocker.release()
		require.NoError(t, <-resetDone)
		require.NoError(t, <-assignDone)
		require.NoError(t, service.AssignSandbox(ctx, "101", leaseDirect.SandboxID))
	})
}
