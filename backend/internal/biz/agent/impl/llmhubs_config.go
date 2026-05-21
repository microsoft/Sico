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
	"strings"

	llmhubsSVC "sico-backend/internal/biz/llmhubs"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/errcode"
	"sico-backend/internal/store/agent/singleagent/repository"
	"sico-backend/internal/transport/http/dto/agent/single_agent"
	llmhubsDTO "sico-backend/internal/transport/http/dto/llmhubs"
)

func normalizeLLMHubConfig(cfg *single_agent.LLMHubConfig) (*repository.SingleAgentLLMHubConfigModel, error) {
	if cfg == nil {
		return nil, nil
	}

	seen := make(map[string]struct{}, len(cfg.ModelKeys))
	modelKeys := make([]string, 0, len(cfg.ModelKeys))
	for _, key := range cfg.ModelKeys {
		normalizedKey := strings.ToLower(strings.TrimSpace(key))
		if normalizedKey == "" {
			continue
		}
		if _, ok := seen[normalizedKey]; ok {
			continue
		}
		seen[normalizedKey] = struct{}{}
		modelKeys = append(modelKeys, normalizedKey)
	}

	defaultKey := strings.ToLower(strings.TrimSpace(cfg.DefaultGlobalModelKey))
	if defaultKey != "" {
		if _, ok := seen[defaultKey]; !ok {
			return nil, apperr.New(errcode.CommonInvalidParam, "defaultGlobalModelKey must be included in modelKeys")
		}
	}

	return &repository.SingleAgentLLMHubConfigModel{
		ModelKeys:             modelKeys,
		DefaultGlobalModelKey: defaultKey,
	}, nil
}

func (s *Service) attachLLMHubConfig(ctx context.Context, agent *single_agent.SingleAgent) error {
	if s.SingleAgentLLMHubConfigRepo == nil || agent == nil {
		return nil
	}

	config, err := s.SingleAgentLLMHubConfigRepo.Get(ctx, agent.AgentId)
	if err != nil {
		return apperr.Wrap(errcode.CommonInternalError, "failed to load agent llmhubs config", err)
	}
	if config == nil {
		agent.LlmhubConfig = nil
		return nil
	}

	agent.LlmhubConfig = &single_agent.LLMHubConfig{
		ModelKeys:             append([]string(nil), config.ModelKeys...),
		DefaultGlobalModelKey: config.DefaultGlobalModelKey,
	}
	return nil
}

func persistLLMHubConfig(
	ctx context.Context,
	repo repository.SingleAgentLLMHubConfigRepository,
	agentID string,
	config *repository.SingleAgentLLMHubConfigModel,
) error {
	if repo == nil || agentID == "" || config == nil {
		return nil
	}
	config.AgentID = agentID
	if len(config.ModelKeys) == 0 && config.DefaultGlobalModelKey == "" {
		return deleteLLMHubConfig(ctx, repo, agentID)
	}
	if err := validatePersistedLLMHubConfig(ctx, agentID, config); err != nil {
		return err
	}
	if err := repo.Upsert(ctx, config); err != nil {
		return apperr.Wrap(errcode.CommonInternalError, "failed to save agent llmhubs config", err)
	}
	return nil
}

func validatePersistedLLMHubConfig(ctx context.Context, agentID string, config *repository.SingleAgentLLMHubConfigModel) error {
	builtinModels, customModels, err := loadAvailableLLMHubModels(ctx, agentID)
	if err != nil {
		return err
	}

	allowedKeys, builtinKeys := buildAvailableModelKeySets(builtinModels, customModels)
	return validateAvailableLLMHubConfig(config.ModelKeys, config.DefaultGlobalModelKey, allowedKeys, builtinKeys)
}

func loadAvailableLLMHubModels(
	ctx context.Context,
	agentID string,
) ([]*llmhubsDTO.ModelRegistryEntry, []*llmhubsDTO.ModelRegistryEntry, error) {
	svc := llmhubsSVC.Default()
	if svc == nil {
		return nil, nil, apperr.New(errcode.CommonUnavailable, "llmhub service not initialized")
	}

	builtinModels, err := svc.ListBuiltinModels(ctx)
	if err != nil {
		return nil, nil, err
	}

	customModels, err := llmhubsSVC.ListAgentCustomModelEntries(ctx, agentID)
	if err != nil {
		return nil, nil, err
	}

	return builtinModels, customModels, nil
}

func buildAvailableModelKeySets(
	builtinModels, customModels []*llmhubsDTO.ModelRegistryEntry,
) (map[string]struct{}, map[string]struct{}) {
	allowedKeys := make(map[string]struct{}, len(builtinModels)+len(customModels))
	builtinKeys := make(map[string]struct{}, len(builtinModels))

	for _, model := range builtinModels {
		if model == nil {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(model.ModelKey))
		if key == "" {
			continue
		}
		allowedKeys[key] = struct{}{}
		builtinKeys[key] = struct{}{}
	}

	for _, model := range customModels {
		if model == nil {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(model.ModelKey))
		if key == "" {
			continue
		}
		allowedKeys[key] = struct{}{}
	}

	return allowedKeys, builtinKeys
}

func validateAvailableLLMHubConfig(
	modelKeys []string,
	defaultGlobalModelKey string,
	allowedKeys, builtinKeys map[string]struct{},
) error {
	for _, key := range modelKeys {
		normalizedKey := strings.ToLower(strings.TrimSpace(key))
		if normalizedKey == "" {
			continue
		}
		if _, ok := allowedKeys[normalizedKey]; !ok {
			return apperr.New(
				errcode.CommonInvalidParam,
				fmt.Sprintf("model key %q is not available for this agent", normalizedKey),
			)
		}
	}

	defaultKey := strings.ToLower(strings.TrimSpace(defaultGlobalModelKey))
	if defaultKey != "" {
		if _, ok := builtinKeys[defaultKey]; !ok {
			return apperr.New(
				errcode.CommonInvalidParam,
				fmt.Sprintf("defaultGlobalModelKey %q must reference a builtin model", defaultKey),
			)
		}
	}

	return nil
}

func deleteLLMHubConfig(ctx context.Context, repo repository.SingleAgentLLMHubConfigRepository, agentID string) error {
	if repo == nil || agentID == "" {
		return nil
	}
	if err := repo.Delete(ctx, agentID); err != nil {
		return apperr.Wrap(errcode.CommonInternalError, "failed to delete agent llmhubs config", err)
	}
	return nil
}
