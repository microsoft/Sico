package impl

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"

	agententity "sico-backend/internal/entity/agent/singleagent"
	"sico-backend/internal/errcode"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/enum"
	projectrepo "sico-backend/internal/store/project/repository"
	agentdto "sico-backend/internal/transport/http/dto/agent/single_agent"
)

func TestAssignSandboxRejectsCrossScopeTarget(t *testing.T) {
	tests := []struct {
		name                 string
		targetProjectID      int64
		targetOrganizationID int64
	}{
		{name: "project mismatch", targetProjectID: 8, targetOrganizationID: 9},
		{name: "organization mismatch", targetProjectID: 7, targetOrganizationID: 10},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ctx := context.Background()
			miniRedis := miniredis.RunT(t)
			client := redis.NewClient(&redis.Options{Addr: miniRedis.Addr()})
			t.Cleanup(func() { require.NoError(t, client.Close()) })
			resource := testEmulatorResource(ResourceStatusAvailable)
			seedSnapshot(t, ctx, client, resource.Type, time.Now(), resource)
			sandboxID := "emulator:" + resource.ResourceID
			require.NoError(t, client.Set(ctx, orgAssignKey(sandboxID), "9", 0).Err())
			require.NoError(t, client.Set(ctx, projectAssignKey(sandboxID), "7", 0).Err())
			service := &Service{
				Pool: newTestPool(client, &fakeProvider{providerType: resource.Type}, time.Minute),
				InstanceRepo: &dashboardInstanceRepo{instances: map[int64]*agententity.SingleAgentInstance{
					200: {
						SingleAgentInstance: &agentdto.SingleAgentInstance{
							Id: 200, ProjectId: test.targetProjectID,
						},
					},
				}},
				ProjectRepo: &dashboardProjectRepo{projects: map[int64]*projectrepo.ProjectModel{
					test.targetProjectID: {
						ID: test.targetProjectID, OrganizationID: test.targetOrganizationID,
					},
				}},
			}

			err := service.AssignSandbox(ctx, "200", sandboxID)
			require.Error(t, err)
			require.True(t, isDashboardAccessDenied(err))
			require.Equal(t, int64(0), client.Exists(ctx, resourceLeaseKey(sandboxID)).Val())
		})
	}
}

func TestAssignSandboxAllowsUnboundPhysicalResource(t *testing.T) {
	ctx := context.Background()
	miniRedis := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: miniRedis.Addr()})
	t.Cleanup(func() { require.NoError(t, client.Close()) })
	resource := &Resource{
		Type: enum.SandboxTypePhysical.String(), ResourceID: "http://manager|device-1",
		Status: ResourceStatusAvailable,
	}
	seedSnapshot(t, ctx, client, resource.Type, time.Now(), resource)
	sandboxID := resource.Type + ":" + resource.ResourceID
	service := &Service{
		Pool: newTestPool(client, &fakeProvider{providerType: resource.Type}, time.Minute),
		InstanceRepo: &dashboardInstanceRepo{instances: map[int64]*agententity.SingleAgentInstance{
			200: {SingleAgentInstance: &agentdto.SingleAgentInstance{Id: 200, ProjectId: 0}},
		}},
	}

	require.NoError(t, service.AssignSandbox(ctx, "200", sandboxID))
	lease := loadLease(t, ctx, client, sandboxID)
	require.Equal(t, "200", lease.User)
	require.False(t, lease.InUse)
	require.Equal(t, int64(0), client.Exists(ctx, orgAssignKey(sandboxID)).Val())
	require.Equal(t, int64(0), client.Exists(ctx, projectAssignKey(sandboxID)).Val())
}

func TestAssignSandboxRejectsPartiallyBoundResource(t *testing.T) {
	ctx := context.Background()
	miniRedis := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: miniRedis.Addr()})
	t.Cleanup(func() { require.NoError(t, client.Close()) })
	resource := testEmulatorResource(ResourceStatusAvailable)
	seedSnapshot(t, ctx, client, resource.Type, time.Now(), resource)
	sandboxID := resource.Type + ":" + resource.ResourceID
	require.NoError(t, client.Set(ctx, orgAssignKey(sandboxID), "9", 0).Err())
	service := &Service{
		Pool: newTestPool(client, &fakeProvider{providerType: resource.Type}, time.Minute),
		InstanceRepo: &dashboardInstanceRepo{instances: map[int64]*agententity.SingleAgentInstance{
			200: {SingleAgentInstance: &agentdto.SingleAgentInstance{Id: 200, ProjectId: 7}},
		}},
		ProjectRepo: &dashboardProjectRepo{projects: map[int64]*projectrepo.ProjectModel{
			7: {ID: 7, OrganizationID: 9},
		}},
	}

	err := service.AssignSandbox(ctx, "200", sandboxID)
	require.Error(t, err)
	require.True(t, isDashboardAccessDenied(err))
	require.Equal(t, int64(0), client.Exists(ctx, resourceLeaseKey(sandboxID)).Val())
}

func TestValidateAssignmentScopeValuesAllowsOnlyCompleteStates(t *testing.T) {
	tests := []struct {
		name           string
		projectBinding string
		orgBinding     string
		allowUnbound   bool
		wantError      bool
	}{
		{name: "matching bindings", projectBinding: "7", orgBinding: "9"},
		{name: "unbound inventory", allowUnbound: true},
		{name: "unbound inventory not allowed", wantError: true},
		{name: "project binding only", projectBinding: "7", allowUnbound: true, wantError: true},
		{name: "organization binding only", orgBinding: "9", allowUnbound: true, wantError: true},
		{name: "invalid zero bindings", projectBinding: "0", orgBinding: "0", allowUnbound: true, wantError: true},
		{name: "mismatched bindings", projectBinding: "8", orgBinding: "10", allowUnbound: true, wantError: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ctx := context.Background()
			miniRedis := miniredis.RunT(t)
			client := redis.NewClient(&redis.Options{Addr: miniRedis.Addr()})
			t.Cleanup(func() { require.NoError(t, client.Close()) })
			projectKey := projectAssignKey("physical:device-1")
			orgKey := orgAssignKey("physical:device-1")
			if test.projectBinding != "" {
				require.NoError(t, client.Set(ctx, projectKey, test.projectBinding, 0).Err())
			}
			if test.orgBinding != "" {
				require.NoError(t, client.Set(ctx, orgKey, test.orgBinding, 0).Err())
			}

			err := client.Watch(ctx, func(tx *redis.Tx) error {
				return validateAssignmentScopeValues(
					ctx,
					tx,
					projectKey,
					orgKey,
					7,
					9,
					test.allowUnbound,
				)
			}, projectKey, orgKey)
			if test.wantError {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
		})
	}
}

func TestAssignSandboxToProjectRejectsProjectOrganizationMismatch(t *testing.T) {
	ctx := context.Background()
	miniRedis := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: miniRedis.Addr()})
	t.Cleanup(func() { require.NoError(t, client.Close()) })
	resource := testEmulatorResource(ResourceStatusAvailable)
	seedSnapshot(t, ctx, client, resource.Type, time.Now(), resource)
	sandboxID := resource.Type + ":" + resource.ResourceID
	require.NoError(t, client.Set(ctx, orgAssignKey(sandboxID), "9", 0).Err())
	service := &Service{
		Pool: newTestPool(client, &fakeProvider{providerType: enum.SandboxTypeEmulator.String()}, time.Minute),
		ProjectRepo: &dashboardProjectRepo{projects: map[int64]*projectrepo.ProjectModel{
			7: {ID: 7, OrganizationID: 10},
		}},
	}

	err := service.AssignSandboxToProject(ctx, 7, 9, []string{sandboxID})
	require.Error(t, err)
	appError, ok := apperr.As(err)
	require.True(t, ok)
	require.Equal(t, errcode.SandboxProjectMismatch, appError.Code())
	require.Equal(t, int64(0), client.Exists(ctx, projectAssignKey(sandboxID)).Val())
}

func TestAssignSandboxToProjectRejectsUnknownResourceWithoutMutation(t *testing.T) {
	ctx := context.Background()
	miniRedis := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: miniRedis.Addr()})
	t.Cleanup(func() { require.NoError(t, client.Close()) })
	unknownID := "emulator:http://74.179.80.110:8000|missing"
	require.NoError(t, client.Set(ctx, orgAssignKey(unknownID), "9", 0).Err())
	service := &Service{
		Pool: newTestPool(client, nil, time.Minute),
		ProjectRepo: &dashboardProjectRepo{projects: map[int64]*projectrepo.ProjectModel{
			7: {ID: 7, OrganizationID: 9},
		}},
	}

	err := service.AssignSandboxToProject(ctx, 7, 9, []string{unknownID})
	require.Error(t, err)
	appError, ok := apperr.As(err)
	require.True(t, ok)
	require.Equal(t, errcode.CommonNotFound, appError.Code())
	require.Equal(t, int64(0), client.Exists(ctx, projectAssignKey(unknownID)).Val())
	require.Equal(t, int64(0), client.SCard(ctx, projectSandboxesKey(7)).Val())
}

func TestAssignSandboxToOrgRejectsUnknownResourceWithoutMutation(t *testing.T) {
	ctx := context.Background()
	miniRedis := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: miniRedis.Addr()})
	t.Cleanup(func() { require.NoError(t, client.Close()) })
	resource := testEmulatorResource(ResourceStatusAvailable)
	seedSnapshot(t, ctx, client, resource.Type, time.Now(), resource)
	knownID := resource.Type + ":" + resource.ResourceID
	unknownID := resource.Type + ":missing"
	service := &Service{Pool: newTestPool(
		client,
		&fakeProvider{providerType: resource.Type},
		time.Minute,
	)}

	err := service.AssignSandboxToOrg(ctx, 9, []string{knownID, unknownID})
	require.Error(t, err)
	require.Equal(t, int64(0), client.Exists(ctx, orgAssignKey(knownID)).Val())
	require.Equal(t, int64(0), client.SCard(ctx, orgSandboxesKey(9)).Val())
}

func TestAssignSandboxToOrgBatchConflictLeavesAllUnchanged(t *testing.T) {
	ctx := context.Background()
	miniRedis := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: miniRedis.Addr()})
	t.Cleanup(func() { require.NoError(t, client.Close()) })
	first := testEmulatorResource(ResourceStatusAvailable)
	second := testEmulatorResource(ResourceStatusAvailable)
	second.ResourceID = "http://74.179.80.110:8000|4"
	seedSnapshot(t, ctx, client, first.Type, time.Now(), first, second)
	firstID := first.Type + ":" + first.ResourceID
	secondID := second.Type + ":" + second.ResourceID
	require.NoError(t, client.Set(ctx, orgAssignKey(secondID), "10", 0).Err())
	service := &Service{Pool: newTestPool(
		client,
		&fakeProvider{providerType: first.Type},
		time.Minute,
	)}

	err := service.AssignSandboxToOrg(ctx, 9, []string{firstID, secondID})
	require.Error(t, err)
	require.Equal(t, int64(0), client.Exists(ctx, orgAssignKey(firstID)).Val())
	require.Equal(t, int64(0), client.SCard(ctx, orgSandboxesKey(9)).Val())
	require.Equal(t, "10", client.Get(ctx, orgAssignKey(secondID)).Val())
}

func TestScopeUnassignRejectsDifferentOwner(t *testing.T) {
	ctx := context.Background()
	miniRedis := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: miniRedis.Addr()})
	t.Cleanup(func() { require.NoError(t, client.Close()) })
	sandboxID := testEmulatorLease().SandboxID
	require.NoError(t, client.Set(ctx, orgAssignKey(sandboxID), "10", 0).Err())
	require.NoError(t, client.Set(ctx, projectAssignKey(sandboxID), "8", 0).Err())
	service := &Service{Pool: newTestPool(
		client,
		&fakeProvider{providerType: enum.SandboxTypeEmulator.String()},
		time.Minute,
	)}

	require.Error(t, service.UnassignSandboxFromOrg(ctx, 9, []string{sandboxID}))
	require.Equal(t, "10", client.Get(ctx, orgAssignKey(sandboxID)).Val())
	require.Error(t, service.UnassignSandboxFromProject(ctx, 7, []string{sandboxID}))
	require.Equal(t, "8", client.Get(ctx, projectAssignKey(sandboxID)).Val())
}

func TestScopeBatchMutationsAreAllOrNothing(t *testing.T) {
	t.Run("organization unassign conflict", func(t *testing.T) {
		ctx := context.Background()
		miniRedis := miniredis.RunT(t)
		client := redis.NewClient(&redis.Options{Addr: miniRedis.Addr()})
		t.Cleanup(func() { require.NoError(t, client.Close()) })
		firstID := testEmulatorLease().SandboxID
		secondID := "emulator:http://74.179.80.110:8000|4"
		for _, sandboxID := range []string{firstID, secondID} {
			require.NoError(t, client.Set(ctx, orgAssignKey(sandboxID), "9", 0).Err())
			require.NoError(t, client.SAdd(ctx, orgSandboxesKey(9), sandboxID).Err())
		}
		require.NoError(t, client.Set(ctx, projectAssignKey(secondID), "7", 0).Err())
		service := &Service{Pool: newTestPool(client, nil, time.Minute)}

		require.Error(t, service.UnassignSandboxFromOrg(ctx, 9, []string{firstID, secondID}))
		require.Equal(t, "9", client.Get(ctx, orgAssignKey(firstID)).Val())
		require.Equal(t, int64(2), client.SCard(ctx, orgSandboxesKey(9)).Val())
	})

	t.Run("project assign conflict", func(t *testing.T) {
		ctx := context.Background()
		miniRedis := miniredis.RunT(t)
		client := redis.NewClient(&redis.Options{Addr: miniRedis.Addr()})
		t.Cleanup(func() { require.NoError(t, client.Close()) })
		first := testEmulatorResource(ResourceStatusAvailable)
		second := testEmulatorResource(ResourceStatusAvailable)
		second.ResourceID = "http://74.179.80.110:8000|4"
		seedSnapshot(t, ctx, client, first.Type, time.Now(), first, second)
		firstID := first.Type + ":" + first.ResourceID
		secondID := second.Type + ":" + second.ResourceID
		for _, sandboxID := range []string{firstID, secondID} {
			require.NoError(t, client.Set(ctx, orgAssignKey(sandboxID), "9", 0).Err())
		}
		require.NoError(t, client.Set(ctx, projectAssignKey(secondID), "8", 0).Err())
		service := &Service{
			Pool: newTestPool(client, nil, time.Minute),
			ProjectRepo: &dashboardProjectRepo{projects: map[int64]*projectrepo.ProjectModel{
				7: {ID: 7, OrganizationID: 9},
			}},
		}

		require.Error(t, service.AssignSandboxToProject(ctx, 7, 9, []string{firstID, secondID}))
		require.Equal(t, int64(0), client.Exists(ctx, projectAssignKey(firstID)).Val())
		require.Equal(t, int64(0), client.SCard(ctx, projectSandboxesKey(7)).Val())
	})

	t.Run("project unassign conflict", func(t *testing.T) {
		ctx := context.Background()
		miniRedis := miniredis.RunT(t)
		client := redis.NewClient(&redis.Options{Addr: miniRedis.Addr()})
		t.Cleanup(func() { require.NoError(t, client.Close()) })
		firstLease := testEmulatorLease()
		firstLease.InUse = true
		secondID := "emulator:http://74.179.80.110:8000|4"
		seedLease(t, ctx, client, firstLease)
		require.NoError(t, client.Set(ctx, projectAssignKey(firstLease.SandboxID), "7", 0).Err())
		require.NoError(t, client.Set(ctx, projectAssignKey(secondID), "8", 0).Err())
		require.NoError(t, client.SAdd(ctx, projectSandboxesKey(7), firstLease.SandboxID).Err())
		service := &Service{Pool: newTestPool(client, nil, time.Minute)}

		require.Error(t, service.UnassignSandboxFromProject(
			ctx,
			7,
			[]string{firstLease.SandboxID, secondID},
		))
		require.Equal(t, "7", client.Get(ctx, projectAssignKey(firstLease.SandboxID)).Val())
		require.Equal(t, int64(1), client.Exists(ctx, resourceLeaseKey(firstLease.SandboxID)).Val())
		require.True(t, client.HExists(ctx, assignKey(firstLease.User), firstLease.SandboxID).Val())
	})
}

func TestUnassignSandboxFromProjectAtomicallyRemovesInUseLease(t *testing.T) {
	ctx := context.Background()
	miniRedis := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: miniRedis.Addr()})
	t.Cleanup(func() { require.NoError(t, client.Close()) })
	lease := testEmulatorLease()
	lease.InUse = true
	seedLease(t, ctx, client, lease)
	require.NoError(t, client.Set(ctx, projectAssignKey(lease.SandboxID), "7", 0).Err())
	require.NoError(t, client.SAdd(ctx, projectSandboxesKey(7), lease.SandboxID).Err())
	service := &Service{Pool: newTestPool(client, nil, time.Minute)}

	require.NoError(t, service.UnassignSandboxFromProject(ctx, 7, []string{lease.SandboxID}))
	require.Equal(t, int64(0), client.Exists(ctx, projectAssignKey(lease.SandboxID)).Val())
	require.Equal(t, int64(0), client.Exists(ctx, resourceLeaseKey(lease.SandboxID)).Val())
	require.False(t, client.HExists(ctx, assignKey(lease.User), lease.SandboxID).Val())
	require.Equal(t, int64(1), client.Exists(ctx, cooldownKey(lease.SandboxID)).Val())
}

func TestScopeMutationWrongTypeFailsBeforeMutation(t *testing.T) {
	t.Run("organization reverse index", func(t *testing.T) {
		ctx := context.Background()
		miniRedis := miniredis.RunT(t)
		client := redis.NewClient(&redis.Options{Addr: miniRedis.Addr()})
		t.Cleanup(func() { require.NoError(t, client.Close()) })
		resource := testEmulatorResource(ResourceStatusAvailable)
		seedSnapshot(t, ctx, client, resource.Type, time.Now(), resource)
		sandboxID := resource.Type + ":" + resource.ResourceID
		require.NoError(t, client.Set(ctx, orgSandboxesKey(9), "wrong-type", 0).Err())
		service := &Service{Pool: newTestPool(client, nil, time.Minute)}

		require.Error(t, service.AssignSandboxToOrg(ctx, 9, []string{sandboxID}))
		require.Equal(t, int64(0), client.Exists(ctx, orgAssignKey(sandboxID)).Val())
	})

	t.Run("instance reverse index", func(t *testing.T) {
		ctx := context.Background()
		miniRedis := miniredis.RunT(t)
		client := redis.NewClient(&redis.Options{Addr: miniRedis.Addr()})
		t.Cleanup(func() { require.NoError(t, client.Close()) })
		lease := testEmulatorLease()
		payload, err := json.Marshal(lease)
		require.NoError(t, err)
		require.NoError(t, client.Set(ctx, resourceLeaseKey(lease.SandboxID), payload, 0).Err())
		require.NoError(t, client.Set(ctx, assignKey(lease.User), "wrong-type", 0).Err())
		require.NoError(t, client.Set(ctx, projectAssignKey(lease.SandboxID), "7", 0).Err())
		require.NoError(t, client.SAdd(ctx, projectSandboxesKey(7), lease.SandboxID).Err())
		service := &Service{Pool: newTestPool(client, nil, time.Minute)}

		require.Error(t, service.UnassignSandboxFromProject(ctx, 7, []string{lease.SandboxID}))
		require.Equal(t, "7", client.Get(ctx, projectAssignKey(lease.SandboxID)).Val())
		require.Equal(t, int64(1), client.Exists(ctx, resourceLeaseKey(lease.SandboxID)).Val())
	})
}

func TestLeaseMutationWrongTypeFailsBeforeMutation(t *testing.T) {
	t.Run("assignment reverse index", func(t *testing.T) {
		ctx := context.Background()
		miniRedis := miniredis.RunT(t)
		client := redis.NewClient(&redis.Options{Addr: miniRedis.Addr()})
		t.Cleanup(func() { require.NoError(t, client.Close()) })
		resource := testEmulatorResource(ResourceStatusAvailable)
		seedSnapshot(t, ctx, client, resource.Type, time.Now(), resource)
		sandboxID := resource.Type + ":" + resource.ResourceID
		service := &Service{Pool: newTestPool(
			client,
			&fakeProvider{providerType: resource.Type},
			time.Minute,
		)}
		configureAssignmentScope(t, ctx, client, service, sandboxID, 123)
		require.NoError(t, client.Set(ctx, assignKey("123"), "wrong-type", 0).Err())

		require.Error(t, service.AssignSandbox(ctx, "123", sandboxID))
		require.Equal(t, int64(0), client.Exists(ctx, resourceLeaseKey(sandboxID)).Val())
	})

	t.Run("unassignment reverse index", func(t *testing.T) {
		ctx := context.Background()
		miniRedis := miniredis.RunT(t)
		client := redis.NewClient(&redis.Options{Addr: miniRedis.Addr()})
		t.Cleanup(func() { require.NoError(t, client.Close()) })
		lease := testEmulatorLease()
		lease.InUse = true
		payload, err := json.Marshal(lease)
		require.NoError(t, err)
		require.NoError(t, client.Set(ctx, resourceLeaseKey(lease.SandboxID), payload, 0).Err())
		require.NoError(t, client.Set(ctx, assignKey(lease.User), "wrong-type", 0).Err())
		service := &Service{Pool: newTestPool(client, nil, time.Minute)}

		require.Error(t, service.UnassignSandbox(ctx, lease.User, lease.SandboxID))
		require.Equal(t, int64(1), client.Exists(ctx, resourceLeaseKey(lease.SandboxID)).Val())
		stored := loadLease(t, ctx, client, lease.SandboxID)
		require.True(t, stored.InUse)
		require.Equal(t, int64(0), client.Exists(ctx, cooldownKey(lease.SandboxID)).Val())
	})
}

func TestStrictScopeBindingPropagatesRedisErrors(t *testing.T) {
	command := redis.NewStringCmd(context.Background())
	command.SetErr(context.DeadlineExceeded)
	_, err := strictScopeBinding(command)
	require.True(t, errors.Is(err, context.DeadlineExceeded))
}

func TestSandboxOperationLocksRejectOversizedBatch(t *testing.T) {
	sandboxIDs := make([]string, maxSandboxOperationLockBatch+1)
	for index := range sandboxIDs {
		sandboxIDs[index] = fmt.Sprintf("emulator:resource-%03d", index)
	}

	err := (&Service{}).withSandboxOperationLocks(context.Background(), sandboxIDs, func() error {
		t.Fatal("oversized lock batch executed its mutation")
		return nil
	})
	appError, ok := apperr.As(err)
	require.True(t, ok)
	require.Equal(t, errcode.CommonInvalidParam, appError.Code())

	err = (&Service{}).AssignSandboxToOrg(context.Background(), 1, sandboxIDs)
	appError, ok = apperr.As(err)
	require.True(t, ok)
	require.Equal(t, errcode.CommonInvalidParam, appError.Code())
}

func TestSandboxOperationLocksUseOneDeadlineAndReleasePartialAcquisition(t *testing.T) {
	ctx := context.Background()
	miniRedis := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: miniRedis.Addr()})
	t.Cleanup(func() { require.NoError(t, client.Close()) })
	firstID, secondID := "emulator:a", "emulator:b"
	require.NoError(t, client.Set(ctx, sandboxOperationLockKey(secondID), "held", time.Minute).Err())
	service := &Service{Pool: newTestPool(client, nil, time.Minute)}
	mutationCalled := false
	deadlineContext, cancel := context.WithTimeout(ctx, 150*time.Millisecond)
	defer cancel()

	err := service.withSandboxOperationLocks(
		deadlineContext,
		[]string{secondID, firstID},
		func() error {
			mutationCalled = true
			return nil
		},
	)
	require.ErrorIs(t, err, context.DeadlineExceeded)
	require.False(t, mutationCalled)
	require.Equal(t, int64(0), client.Exists(ctx, sandboxOperationLockKey(firstID)).Val())
	require.Equal(t, "held", client.Get(ctx, sandboxOperationLockKey(secondID)).Val())
}
