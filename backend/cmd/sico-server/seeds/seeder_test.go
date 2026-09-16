package seeds

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	agententity "sico-backend/internal/entity/agent/singleagent"
	"sico-backend/internal/shared/enum"
	agentdto "sico-backend/internal/transport/http/dto/agent/single_agent"
	"sico-backend/pkg/env"
)

func TestDefaultAgentInstancesAreActive(t *testing.T) {
	factories := []func(string) (*agententity.SingleAgent, *agententity.SingleAgentInstance){
		getAgentSimpleChat,
		getAgentAndroidTester,
		getAgent3DArtist,
		getAgentProductManager,
		getAgentMarketing,
		getAgentLinuxWorkstationPilot,
	}

	for _, factory := range factories {
		_, instance := factory("icon.svg")
		require.Equal(t, agentdto.SingleAgentInstanceStatus_INSTANCE_ACTIVE, instance.Status)
	}
}

func TestLinuxWorkstationPilotUsesFixedUnusedIdentity(t *testing.T) {
	agent, instance := getAgentLinuxWorkstationPilot("icon.svg")

	require.Equal(t, "00000000-0000-0000-0000-000000000006", agent.AgentId)
	require.Equal(t, int64(6), instance.Id)
	require.Equal(t, "Linux Workstation Pilot", agent.Name)
	require.Equal(t, agentdto.SingleAgentInstanceStatus_INSTANCE_ACTIVE, instance.Status)
}

func TestSeedAgentInstancesDefaultsToFalse(t *testing.T) {
	t.Setenv(env.SeedAgentInstancesKey, "")
	require.False(t, shouldSeedAgentInstances())

	t.Setenv(env.SeedAgentInstancesKey, "true")
	require.True(t, shouldSeedAgentInstances())
}

func TestDefaultAgentsAreGlobal(t *testing.T) {
	factories := []func(string) (*agententity.SingleAgent, *agententity.SingleAgentInstance){
		getAgentSimpleChat,
		getAgentAndroidTester,
		getAgent3DArtist,
		getAgentProductManager,
		getAgentMarketing,
		getAgentLinuxWorkstationPilot,
	}

	for _, factory := range factories {
		agent, _ := factory("icon.svg")
		require.Zero(t, agent.OrganizationId)
	}
}

type fakeLinuxWorkstationAssignmentService struct {
	assigned        []map[string]interface{}
	resources       map[string]interface{}
	orgID           int64
	projectID       int64
	listCalls       int
	orgAssignCalls  int
	projectCalls    int
	instanceCalls   int
	assignedSandbox string
}

func (f *fakeLinuxWorkstationAssignmentService) ListAllResources(context.Context) (map[string]interface{}, error) {
	f.listCalls++
	return f.resources, nil
}

func (f *fakeLinuxWorkstationAssignmentService) GetInstanceSandboxesWithStatus(
	context.Context, string, string,
) ([]map[string]interface{}, error) {
	return f.assigned, nil
}

func (f *fakeLinuxWorkstationAssignmentService) GetSandboxOrgID(context.Context, string) (int64, error) {
	return f.orgID, nil
}

func (f *fakeLinuxWorkstationAssignmentService) GetSandboxProjectID(context.Context, string) (int64, error) {
	return f.projectID, nil
}

func (f *fakeLinuxWorkstationAssignmentService) AssignSandboxToOrg(context.Context, int64, []string) error {
	f.orgAssignCalls++
	return nil
}

func (f *fakeLinuxWorkstationAssignmentService) AssignSandboxToProject(context.Context, int64, int64, []string) error {
	f.projectCalls++
	return nil
}

func (f *fakeLinuxWorkstationAssignmentService) AssignSandbox(_ context.Context, _ string, sandboxID string) error {
	f.instanceCalls++
	f.assignedSandbox = sandboxID
	return nil
}

func TestReconcileLinuxWorkstationPreservesExistingAssignment(t *testing.T) {
	svc := &fakeLinuxWorkstationAssignmentService{
		assigned:  []map[string]interface{}{{"status": "assigned", "sandbox_id": "linux_workstation:one"}},
		orgID:     defaultOrganizationId,
		projectID: defaultProjectId,
	}

	err := reconcileLinuxWorkstationAssignment(context.Background(), svc, "6")

	require.NoError(t, err)
	require.Zero(t, svc.listCalls)
	require.Zero(t, svc.instanceCalls)
}

func TestReconcileLinuxWorkstationAssignsScopesAndInstance(t *testing.T) {
	svc := &fakeLinuxWorkstationAssignmentService{resources: map[string]interface{}{
		"linux_workstation": []map[string]interface{}{{
			"sandbox_id": "linux_workstation:http://linux-workstation-sandbox:8080", "allocatable": true,
		}},
	}}

	err := reconcileLinuxWorkstationAssignment(context.Background(), svc, "6")

	require.NoError(t, err)
	require.Equal(t, 1, svc.orgAssignCalls)
	require.Equal(t, 1, svc.projectCalls)
	require.Equal(t, 1, svc.instanceCalls)
	require.Equal(t, "linux_workstation:http://linux-workstation-sandbox:8080", svc.assignedSandbox)
}

func TestEnsureSandboxScopesDoesNotRepeatExistingBindings(t *testing.T) {
	svc := &fakeLinuxWorkstationAssignmentService{orgID: defaultOrganizationId, projectID: defaultProjectId}

	err := ensureSandboxScopes(context.Background(), svc, "linux_workstation:one")

	require.NoError(t, err)
	require.Zero(t, svc.orgAssignCalls)
	require.Zero(t, svc.projectCalls)
}

func TestEnsureAvailableSandboxScopesDoesNotAssignInstances(t *testing.T) {
	svc := &fakeLinuxWorkstationAssignmentService{resources: map[string]interface{}{
		enum.SandboxTypeLinuxWorkstation.String(): []map[string]interface{}{{
			"sandbox_id": "linux_workstation:one", "allocatable": true,
		}},
		enum.SandboxTypeEmulator.String(): []map[string]interface{}{{
			"sandbox_id": "emulator:one", "allocatable": true,
		}},
	}}

	ensureAvailableSandboxScopes(context.Background(), svc)

	require.Equal(t, 2, svc.orgAssignCalls)
	require.Equal(t, 2, svc.projectCalls)
	require.Zero(t, svc.instanceCalls)
}

func TestReconcileLinuxWorkstationWithoutAvailableResourceIsNonFatal(t *testing.T) {
	previousAttempts := linuxWorkstationPollMaxAttempts
	linuxWorkstationPollMaxAttempts = 1
	t.Cleanup(func() { linuxWorkstationPollMaxAttempts = previousAttempts })
	svc := &fakeLinuxWorkstationAssignmentService{
		resources: map[string]interface{}{"linux_workstation": []map[string]interface{}{}},
	}

	err := reconcileLinuxWorkstationAssignment(context.Background(), svc, "6")

	require.NoError(t, err)
	require.Equal(t, 1, svc.listCalls)
	require.Zero(t, svc.instanceCalls)
}
