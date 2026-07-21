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
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"

	"sico-backend/internal/transport/http/dto/agent/single_agent"

	entity "sico-backend/internal/entity/agent/singleagent"
	"sico-backend/internal/store/agent/singleagent/repository"
	projectrepo "sico-backend/internal/store/project/repository"
)

// ---------------------------------------------------------------------------
// Minimal mocks — only the methods exercised by tests are implemented.
// ---------------------------------------------------------------------------

type mockAgentRepo struct {
	repository.SingleAgentRepository // embed to satisfy interface for untested methods
	agents                           map[string]*entity.SingleAgent
}

func (m *mockAgentRepo) Get(_ context.Context, agentID string) (*entity.SingleAgent, error) {
	a, ok := m.agents[agentID]
	if !ok {
		return nil, nil
	}
	// Return a clone so callers mutating the result don't affect stored data.
	return &entity.SingleAgent{SingleAgent: proto.Clone(a.SingleAgent).(*single_agent.SingleAgent)}, nil
}

func (m *mockAgentRepo) List(_ context.Context, _ string, offset, limit int) ([]*entity.SingleAgent, int64, error) {
	all := make([]*entity.SingleAgent, 0, len(m.agents))
	for _, a := range m.agents {
		all = append(all, a)
	}
	total := int64(len(all))
	end := offset + limit
	if end > len(all) {
		end = len(all)
	}
	if offset >= len(all) {
		return nil, total, nil
	}
	return all[offset:end], total, nil
}

type mockInstanceRepo struct {
	repository.SingleAgentInstanceRepository
	instances map[int64]*entity.SingleAgentInstance
	nextID    int64
}

func (m *mockInstanceRepo) Get(_ context.Context, id int64) (*entity.SingleAgentInstance, error) {
	inst, ok := m.instances[id]
	if !ok {
		return nil, gorm.ErrRecordNotFound
	}
	return inst, nil
}

func (m *mockInstanceRepo) Create(_ context.Context, inst *entity.SingleAgentInstance) (int64, error) {
	m.nextID++
	inst.Id = m.nextID
	m.instances[m.nextID] = inst
	return m.nextID, nil
}

type mockProjectRepo struct {
	projectrepo.ProjectRepository
	added []*projectrepo.ProjectUserModel
}

func (m *mockProjectRepo) AddProjectUser(_ context.Context, model *projectrepo.ProjectUserModel) error {
	m.added = append(m.added, model)
	return nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func newTestService(agentRepo *mockAgentRepo, instanceRepo *mockInstanceRepo, projectRepo *mockProjectRepo) *Service {
	return NewService(
		&Components{
			SingleAgentRepo:         agentRepo,
			SingleAgentInstanceRepo: instanceRepo,
			ProjectRepo:             projectRepo,
		},
		nil, // DB — nil means no transactions, simpler for unit tests
	)
}

func makeAgent(id, name string) *entity.SingleAgent {
	return &entity.SingleAgent{SingleAgent: &single_agent.SingleAgent{
		AgentId: id,
		Name:    name,
	}}
}

func makeInstance(id int64, agentID, name string) *entity.SingleAgentInstance {
	return &entity.SingleAgentInstance{SingleAgentInstance: &single_agent.SingleAgentInstance{
		Id:      id,
		AgentId: agentID,
		Name:    name,
	}}
}

// ===========================================================================
// Tests
// ===========================================================================

func TestGetSingleAgent(t *testing.T) {
	repo := &mockAgentRepo{agents: map[string]*entity.SingleAgent{
		"a1": makeAgent("a1", "Agent One"),
	}}
	svc := newTestService(repo, nil, nil)

	t.Run("existing agent", func(t *testing.T) {
		agent, err := svc.getSingleAgent(context.Background(), "a1")
		require.NoError(t, err)
		require.NotNil(t, agent)
		assert.Equal(t, "Agent One", agent.Name)
	})

	t.Run("non-existent agent returns nil", func(t *testing.T) {
		agent, err := svc.getSingleAgent(context.Background(), "missing")
		require.NoError(t, err)
		assert.Nil(t, agent)
	})
}

func TestListSingleAgents(t *testing.T) {
	repo := &mockAgentRepo{agents: map[string]*entity.SingleAgent{
		"a1": makeAgent("a1", "A"),
		"a2": makeAgent("a2", "B"),
		"a3": makeAgent("a3", "C"),
	}}
	svc := newTestService(repo, nil, nil)

	t.Run("first page", func(t *testing.T) {
		agents, total, hasNext, err := svc.listSingleAgents(context.Background(), &single_agent.ListSingleAgentsRequest{
			Page: 1, PageSize: 2,
		})
		require.NoError(t, err)
		assert.Equal(t, int64(3), total)
		assert.Len(t, agents, 2)
		assert.True(t, hasNext)
	})

	t.Run("last page", func(t *testing.T) {
		agents, total, hasNext, err := svc.listSingleAgents(context.Background(), &single_agent.ListSingleAgentsRequest{
			Page: 2, PageSize: 2,
		})
		require.NoError(t, err)
		assert.Equal(t, int64(3), total)
		assert.Len(t, agents, 1)
		assert.False(t, hasNext)
	})
}

func TestCreateSingleAgentInstance(t *testing.T) {
	agentRepo := &mockAgentRepo{agents: map[string]*entity.SingleAgent{
		"a1": makeAgent("a1", "Agent One"),
	}}
	instanceRepo := &mockInstanceRepo{instances: make(map[int64]*entity.SingleAgentInstance)}
	projectRepo := &mockProjectRepo{}
	svc := newTestService(agentRepo, instanceRepo, projectRepo)

	t.Run("success", func(t *testing.T) {
		inst := makeInstance(0, "a1", "Instance 1")
		inst.OperatorUsername = "user1"
		inst.ProjectId = 10

		id, err := svc.createSingleAgentInstance(context.Background(), inst)
		require.NoError(t, err)
		assert.Greater(t, id, int64(0))

		// Verify instance was persisted
		stored, err := instanceRepo.Get(context.Background(), id)
		require.NoError(t, err)
		assert.Equal(t, "Instance 1", stored.Name)
	})

	t.Run("nil instance", func(t *testing.T) {
		_, err := svc.createSingleAgentInstance(context.Background(), nil)
		require.Error(t, err)
	})

	t.Run("agent not found", func(t *testing.T) {
		inst := makeInstance(0, "missing-agent", "Instance X")
		_, err := svc.createSingleAgentInstance(context.Background(), inst)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "not found")
	})
}

func TestDeploySingleAgent(t *testing.T) {
	agentRepo := &mockAgentRepo{agents: map[string]*entity.SingleAgent{
		"a1": {SingleAgent: &single_agent.SingleAgent{
			AgentId:    "a1",
			Name:       "Agent One",
			Role:       "Tester",
			Desc:       "Base desc",
			IconUri:    "icons/agent.svg",
			RawIconUri: "raw/icons/agent.svg",
		}},
	}}
	instanceRepo := &mockInstanceRepo{instances: make(map[int64]*entity.SingleAgentInstance)}
	svc := newTestService(agentRepo, instanceRepo, nil)

	t.Run("success", func(t *testing.T) {
		resp, err := svc.DeploySingleAgent(context.Background(), &single_agent.DeploySingleAgentRequest{
			AgentId: "a1",
			Name:    "Deployed Agent",
		}, "operator@sico.local")
		require.NoError(t, err)
		require.NotNil(t, resp.Data)
		assert.Equal(t, "a1", resp.Data.AgentId)
		assert.Equal(t, "operator@sico.local", resp.Data.EmployerUsername)

		stored, err := instanceRepo.Get(context.Background(), resp.Data.Id)
		require.NoError(t, err)
		assert.Equal(t, "Deployed Agent", stored.Name)
		assert.Equal(t, "operator@sico.local", stored.OperatorUsername)
		assert.Equal(t, "operator@sico.local", stored.EmployerUsername)
		assert.Equal(t, "Tester", stored.Role)
		assert.Equal(t, "Base desc", stored.Desc)
		assert.Equal(t, "icons/agent.svg", stored.IconUri)
		assert.Equal(t, "raw/icons/agent.svg", stored.RawIconUri)
	})

	t.Run("requires agent id", func(t *testing.T) {
		_, err := svc.DeploySingleAgent(
			context.Background(),
			&single_agent.DeploySingleAgentRequest{Name: "x"},
			"operator",
		)
		require.Error(t, err)
	})

	t.Run("agent not found", func(t *testing.T) {
		_, err := svc.DeploySingleAgent(context.Background(), &single_agent.DeploySingleAgentRequest{
			AgentId: "missing",
			Name:    "Missing",
		}, "operator")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "not found")
	})
}

func TestObtainInstantiatedAgent(t *testing.T) {
	agentRepo := &mockAgentRepo{agents: map[string]*entity.SingleAgent{
		"a1": {SingleAgent: &single_agent.SingleAgent{
			AgentId: "a1",
			Name:    "Base Agent",
			Desc:    "Base desc",
		}},
	}}
	instanceRepo := &mockInstanceRepo{instances: map[int64]*entity.SingleAgentInstance{
		100: {SingleAgentInstance: &single_agent.SingleAgentInstance{
			Id:      100,
			AgentId: "a1",
			Name:    "Custom Name",
			Desc:    "Custom desc",
		}},
	}}
	svc := newTestService(agentRepo, instanceRepo, nil)

	t.Run("merges instance overrides onto agent", func(t *testing.T) {
		result, err := svc.ObtainInstantiatedAgent(context.Background(), &entity.AgentInstanceIdentity{
			AgentInstanceID: 100,
		})
		require.NoError(t, err)
		require.NotNil(t, result)

		merged := result.MergedAgent
		assert.Equal(t, int64(100), result.InstanceId)

		// Scalar overrides
		assert.Equal(t, "Custom Name", merged.Name)
		assert.Equal(t, "Custom desc", merged.Desc)
	})

	t.Run("instance not found", func(t *testing.T) {
		_, err := svc.ObtainInstantiatedAgent(context.Background(), &entity.AgentInstanceIdentity{
			AgentInstanceID: 999,
		})
		require.Error(t, err)
	})

	t.Run("agent not found for instance", func(t *testing.T) {
		// Create instance pointing to non-existent agent
		instanceRepo.instances[200] = &entity.SingleAgentInstance{SingleAgentInstance: &single_agent.SingleAgentInstance{
			Id:      200,
			AgentId: "missing",
		}}
		_, err := svc.ObtainInstantiatedAgent(context.Background(), &entity.AgentInstanceIdentity{
			AgentInstanceID: 200,
		})
		require.Error(t, err)
	})

	t.Run("no overrides keeps base agent values", func(t *testing.T) {
		instanceRepo.instances[300] = &entity.SingleAgentInstance{SingleAgentInstance: &single_agent.SingleAgentInstance{
			Id:      300,
			AgentId: "a1",
			// No name/desc/prompt overrides
		}}
		result, err := svc.ObtainInstantiatedAgent(context.Background(), &entity.AgentInstanceIdentity{
			AgentInstanceID: 300,
		})
		require.NoError(t, err)
		assert.Equal(t, "Base Agent", result.MergedAgent.Name)
		assert.Equal(t, "Base desc", result.MergedAgent.Desc)
	})
}
