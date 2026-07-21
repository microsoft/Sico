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
	"fmt"
	"strconv"

	"gorm.io/gorm"

	sandboxbiz "sico-backend/internal/biz/sandbox"
	entity "sico-backend/internal/entity/agent/singleagent"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/errcode"
	"sico-backend/internal/store/agent/singleagent/repository"
	"sico-backend/internal/transport/http/dto/agent/single_agent"
	"sico-backend/pkg/logger"
)

func (s *Service) getSingleAgent(ctx context.Context, agentID string) (*entity.SingleAgent, error) {
	return s.SingleAgentRepo.Get(ctx, agentID)
}

func (s *Service) listSingleAgents(
	ctx context.Context, req *single_agent.ListSingleAgentsRequest,
) ([]*entity.SingleAgent, int64, bool, error) {
	offset := int(req.Page-1) * int(req.PageSize)
	limit := int(req.PageSize)

	agents, total, err := s.SingleAgentRepo.List(ctx, req.CreatorUsername, offset, limit)
	if err != nil {
		return nil, 0, false, err
	}

	hasNext := int64(offset+len(agents)) < total
	return agents, total, hasNext, nil
}

func (s *Service) listSingleAgentInfos(ctx context.Context) ([]*single_agent.SingleAgentInfo, error) {
	return s.SingleAgentRepo.ListInfos(ctx)
}

func (s *Service) ObtainInstantiatedAgent(
	ctx context.Context, identity *entity.AgentInstanceIdentity,
) (*entity.InstantiatedAgent, error) {
	instanceID := identity.AgentInstanceID
	instance, err := s.SingleAgentInstanceRepo.Get(ctx, instanceID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperr.New(errcode.CommonNotFound, "agent instance not found")
		}
		return nil, err
	}
	if instance == nil {
		return nil, fmt.Errorf("agent instance with ID %d not found", instanceID)
	}

	agent, err := s.SingleAgentRepo.Get(ctx, instance.AgentId)
	if err != nil {
		return nil, err
	}
	if agent == nil {
		return nil, apperr.New(errcode.CommonNotFound, "agent not found")
	}

	if instance.Name != "" {
		agent.Name = instance.Name
	}
	if instance.Desc != "" {
		agent.Desc = instance.Desc
	}
	if instance.IconUri != "" {
		agent.IconUri = instance.IconUri
	}
	return &entity.InstantiatedAgent{
		MergedAgent: agent,
		InstanceId:  instance.Id,
	}, nil
}

func (s *Service) createSingleAgentInstance(
	ctx context.Context, instance *entity.SingleAgentInstance,
) (int64, error) {
	if instance == nil || instance.SingleAgentInstance == nil {
		return 0, apperr.New(errcode.CommonInvalidParam, "instance is required")
	}

	if s.DB == nil {
		agent, err := s.SingleAgentRepo.Get(ctx, instance.AgentId)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return 0, apperr.New(errcode.CommonNotFound, "agent not found")
			}
			return 0, err
		}
		if agent == nil {
			return 0, apperr.New(errcode.CommonNotFound, "agent not found")
		}
		return s.SingleAgentInstanceRepo.Create(ctx, instance)
	}

	var createdID int64
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		agentRepo := repository.NewSingleAgentRepo(tx)
		instanceRepo := repository.NewSingleAgentInstanceRepo(tx)

		agent, err := agentRepo.GetForUpdate(ctx, instance.AgentId)
		if err != nil {
			return err
		}
		if agent == nil {
			return apperr.New(errcode.CommonNotFound, "agent not found")
		}

		createdID, err = instanceRepo.Create(ctx, instance)
		return err
	})
	if err != nil {
		return 0, err
	}

	return createdID, nil
}

func (s *Service) getSingleAgentInstance(
	ctx context.Context, instanceID int64,
) (*entity.SingleAgentInstance, error) {
	instance, err := s.SingleAgentInstanceRepo.Get(ctx, instanceID)
	if err != nil || instance == nil {
		return instance, err
	}

	s.populateSingleAgentInstanceProjects(ctx, instance)

	return instance, nil
}

func (s *Service) updateSingleAgentInstance(
	ctx context.Context, instance *entity.SingleAgentInstance,
) error {
	return s.SingleAgentInstanceRepo.Update(ctx, instance)
}

func (s *Service) deleteSingleAgentInstance(
	ctx context.Context, instanceID int64,
) error {
	instanceIDStr := strconv.FormatInt(instanceID, 10)
	return sandboxbiz.WithInstanceAssignmentLock(ctx, instanceIDStr, func() error {
		sandboxSvc := sandboxbiz.Default()
		hasAssigned, count, err := sandboxbiz.HasAssignedSandboxesStrict(ctx, instanceIDStr)
		if err != nil {
			return err
		}
		if hasAssigned && sandboxSvc != nil {
			logger.CtxInfo(
				ctx,
				"deleteSingleAgentInstance: cleaning %d sandbox(es) for instance %d before delete",
				count, instanceID,
			)
			if err := sandboxSvc.CleanupInstanceSandboxes(ctx, instanceIDStr); err != nil {
				return err
			}

			hasAssigned, count, err = sandboxbiz.HasAssignedSandboxesStrict(ctx, instanceIDStr)
			if err != nil {
				return err
			}
		}
		if hasAssigned {
			return apperr.New(
				errcode.CommonConflict,
				fmt.Sprintf(
					"instance %d still has %d sandbox(es) bound after cleanup, please retry later",
					instanceID, count,
				),
			)
		}

		return s.SingleAgentInstanceRepo.Delete(ctx, instanceID)
	})
}
