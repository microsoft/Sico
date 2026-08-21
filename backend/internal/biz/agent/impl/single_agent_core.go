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
	"sico-backend/pkg/logger"
)

func (s *Service) getSingleAgent(ctx context.Context, agentID string) (*entity.SingleAgent, error) {
	return s.SingleAgentRepo.Get(ctx, agentID)
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
