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
	"io"
	"time"

	"google.golang.org/grpc"
	"gorm.io/gorm"

	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/errcode"
	agentrepo "sico-backend/internal/store/agent/singleagent/repository"
	registryrepo "sico-backend/internal/store/llmhubs/repository"
	llmhubpb "sico-backend/internal/transport/grpc/pb/llmhubs"
	dto "sico-backend/internal/transport/http/dto/llmhubs"
	"sico-backend/pkg/logger"
)

const (
	// RuntimeTimeout is the default timeout for runtime generate requests.
	RuntimeTimeout = 180 * time.Second

	// statusActive marks a model as callable via the runtime API.
	statusActive int32 = 1
	// statusDisabled marks a model as visible but not callable.
	statusDisabled int32 = 2
)

// Components enumerates dependencies required by the LLMHub service.
type Components struct {
	DB                          *gorm.DB
	CoreGRPC                    *grpc.ClientConn
	ModelRegistryRepo           registryrepo.ModelRegistryRepository
	ModelRegistrySecretRepo     registryrepo.ModelRegistrySecretRepository
	SingleAgentLLMHubConfigRepo agentrepo.SingleAgentLLMHubConfigRepository
}

// Service implements the core LLMHub runtime and the model registry.
type Service struct {
	*Components
	runtimeClient llmhubpb.LLMHubRPCClient
}

// NewService wires dependencies.
func NewService(c *Components) *Service {
	var client llmhubpb.LLMHubRPCClient
	if c != nil && c.CoreGRPC != nil {
		client = llmhubpb.NewLLMHubRPCClient(c.CoreGRPC)
	}
	return &Service{Components: c, runtimeClient: client}
}

// ListBuiltinModels fetches the list of built-in models from core.
func (s *Service) ListBuiltinModels(ctx context.Context) ([]*dto.ModelRegistryEntry, error) {
	if s.runtimeClient == nil {
		return nil, apperr.New(errcode.CommonUnavailable, "llm runtime service not initialized")
	}

	ctx, cancel := context.WithTimeout(ctx, RuntimeTimeout)
	defer cancel()

	resp, err := s.runtimeClient.ListBuiltinModels(ctx, &llmhubpb.ListBuiltinModelsRequest{})
	if err != nil {
		return nil, apperr.Wrap(errcode.CommonInternalError, "failed to list builtin models", err)
	}
	if resp.GetCode() != 0 {
		msg := resp.GetMsg()
		if msg == "" {
			msg = "failed to list builtin models"
		}
		return nil, apperr.New(errcode.CommonInternalError, msg)
	}

	entries := make([]*dto.ModelRegistryEntry, 0, len(resp.Models))
	for _, model := range resp.Models {
		if model == nil {
			continue
		}
		entries = append(entries, &dto.ModelRegistryEntry{
			ModelKey:             model.ModelKey,
			DisplayName:          model.DisplayName,
			ModelType:            model.ModelType,
			ProviderTemplateType: model.ProviderTemplateType,
			Status:               statusActive,
			IsBuiltin:            true,
			Description:          model.Description,
			IconUri:              model.IconUri,
		})
	}
	return entries, nil
}

// RuntimeGenerate calls the core LLM service for synchronous generation.
func (s *Service) RuntimeGenerate(ctx context.Context, req *dto.RuntimeGenerateRequest) (*dto.RuntimeGenerateResponse, error) {
	if s.runtimeClient == nil {
		return nil, apperr.New(errcode.CommonUnavailable, "llm runtime service not initialized")
	}

	modelKey := req.Model
	if modelKey == "" {
		return nil, apperr.New(errcode.CommonInvalidParam, "model field is required")
	}

	modelDef, err := s.resolveRuntimeModelDefinition(ctx, modelKey)
	if err != nil {
		return nil, err
	}

	pbReq := buildRuntimeGRPCRequest(req, modelDef)

	ctx, cancel := context.WithTimeout(ctx, RuntimeTimeout)
	defer cancel()

	resp, err := s.runtimeClient.RuntimeGenerate(ctx, pbReq)
	if err != nil {
		logger.CtxWarn(ctx, "RuntimeGenerate gRPC failed for model=%s: %v", modelKey, err)
		return nil, apperr.Wrap(errcode.LLMHubRuntimeFailed, "runtime generate failed", err)
	}
	if resp.GetCode() != 0 {
		msg := resp.GetMsg()
		logger.CtxWarn(ctx, "RuntimeGenerate upstream error for model=%s code=%d: %s", modelKey, resp.GetCode(), msg)
		if msg == "" {
			msg = "runtime generation failed"
		}
		return nil, apperr.New(errcode.LLMHubRuntimeFailed, msg)
	}

	dtoResp := &dto.RuntimeGenerateResponse{}
	for _, o := range resp.Outputs {
		dtoResp.Outputs = append(dtoResp.Outputs, &dto.RuntimeOutputItem{
			Type: o.Type, Text: o.Text, Json: o.Json,
			CallId: o.CallId, Name: o.Name, Arguments: o.Arguments, Actions: o.Actions,
		})
	}
	if resp.Usage != nil {
		dtoResp.Usage = &dto.RuntimeUsage{
			PromptTokens:     resp.Usage.PromptTokens,
			CompletionTokens: resp.Usage.CompletionTokens,
			TotalTokens:      resp.Usage.TotalTokens,
		}
	}
	if resp.Trace != nil {
		dtoResp.Trace = &dto.RuntimeTrace{
			ProviderTemplateType: resp.Trace.ProviderTemplateType,
			Model:                resp.Trace.Model,
			LatencyMs:            resp.Trace.LatencyMs,
		}
	}
	dtoResp.Payload = resp.Payload

	return dtoResp, nil
}

// RuntimeGenerateStream calls the core LLM service for streaming generation.
func (s *Service) RuntimeGenerateStream(
	ctx context.Context,
	req *dto.RuntimeGenerateRequest,
	onChunk func(chunk *dto.RuntimeStreamChunk) error,
) error {
	if s.runtimeClient == nil {
		return apperr.New(errcode.CommonUnavailable, "llm runtime service not initialized")
	}

	modelKey := req.Model
	if modelKey == "" {
		return apperr.New(errcode.CommonInvalidParam, "model field is required")
	}

	modelDef, err := s.resolveRuntimeModelDefinition(ctx, modelKey)
	if err != nil {
		return err
	}

	pbReq := buildRuntimeGRPCRequest(req, modelDef)

	ctx, cancel := context.WithTimeout(ctx, RuntimeTimeout)
	defer cancel()

	stream, err := s.runtimeClient.RuntimeGenerateStream(ctx, pbReq)
	if err != nil {
		logger.CtxWarn(ctx, "RuntimeGenerateStream gRPC failed for model=%s: %v", modelKey, err)
		return apperr.Wrap(errcode.LLMHubRuntimeFailed, "runtime stream failed", err)
	}

	for {
		chunk, recvErr := stream.Recv()
		if recvErr != nil {
			if errors.Is(recvErr, io.EOF) {
				return nil
			}
			logger.CtxWarn(ctx, "RuntimeGenerateStream recv failed for model=%s: %v", modelKey, recvErr)
			return apperr.Wrap(errcode.LLMHubRuntimeFailed, "stream recv failed", recvErr)
		}

		dtoChunk := &dto.RuntimeStreamChunk{
			Delta: chunk.GetDelta(), FinishReason: chunk.GetFinishReason(),
		}
		for _, o := range chunk.GetOutputs() {
			dtoChunk.Outputs = append(dtoChunk.Outputs, &dto.RuntimeOutputItem{
				Type: o.Type, Text: o.Text, Json: o.Json,
				CallId: o.CallId, Name: o.Name, Arguments: o.Arguments, Actions: o.Actions,
			})
		}
		if chunk.GetUsage() != nil {
			dtoChunk.Usage = &dto.RuntimeUsage{
				PromptTokens:     chunk.Usage.PromptTokens,
				CompletionTokens: chunk.Usage.CompletionTokens,
				TotalTokens:      chunk.Usage.TotalTokens,
			}
		}
		if chunk.GetCode() != 0 {
			dtoChunk.Code = chunk.GetCode()
			dtoChunk.Msg = chunk.GetMsg()
		}

		if err := onChunk(dtoChunk); err != nil {
			return err
		}
	}
}

// resolveRuntimeModelDefinition loads the runtime model definition for a custom
// (registered) model. Returns nil for builtin models so core can resolve them
// from its own YAML catalog.
func (s *Service) resolveRuntimeModelDefinition(ctx context.Context, modelKey string) (*llmhubpb.RuntimeModelDefinition, error) {
	if s.Components == nil || s.ModelRegistryRepo == nil {
		return nil, nil
	}
	m, err := s.ModelRegistryRepo.GetByModelKey(ctx, modelKey)
	if err != nil {
		if registryrepo.IsNotFoundErr(err) {
			return nil, nil
		}
		return nil, apperr.Wrap(errcode.CommonInternalError, "failed to resolve runtime model", err)
	}
	if m.Status != statusActive {
		return nil, apperr.New(errcode.LLMHubInvalidStatus, "model is not active")
	}

	secrets, err := s.loadRuntimeSecrets(ctx, m.ID)
	if err != nil {
		return nil, apperr.Wrap(errcode.CommonInternalError, "failed to load runtime model secrets", err)
	}

	return &llmhubpb.RuntimeModelDefinition{
		ModelKey:             m.ModelKey,
		DisplayName:          m.DisplayName,
		ModelType:            m.ModelType,
		ProviderTemplateType: m.ProviderTemplateType,
		Status:               m.Status,
		Config:               normalizeProviderConfigStruct(m.ProviderTemplateType, jsonToStruct(m.Config)),
		Secrets:              secrets,
	}, nil
}

func (s *Service) loadRuntimeSecrets(ctx context.Context, registryID int64) (map[string]string, error) {
	if s.ModelRegistrySecretRepo == nil {
		return nil, nil
	}
	items, err := s.ModelRegistrySecretRepo.GetSecrets(ctx, registryID)
	if err != nil {
		return nil, err
	}
	secrets := make(map[string]string, len(items))
	for _, item := range items {
		if item == nil || item.SecretKey == "" || item.SecretValue == "" {
			continue
		}
		secrets[item.SecretKey] = item.SecretValue
	}
	return secrets, nil
}

func buildRuntimeGRPCRequest(
	req *dto.RuntimeGenerateRequest,
	modelDef *llmhubpb.RuntimeModelDefinition,
) *llmhubpb.RuntimeGenerateRequest {
	pbReq := &llmhubpb.RuntimeGenerateRequest{
		Model:              req.Model,
		Instructions:       req.Instructions,
		Options:            req.Options,
		Tools:              req.Tools,
		ModelDefinition:    modelDef,
		PreviousResponseId: req.PreviousResponseId,
	}

	for _, input := range req.Inputs {
		pbInput := &llmhubpb.RuntimeInput{Role: input.Role}
		for _, c := range input.Content {
			pbContent := &llmhubpb.RuntimeInputContent{
				Type: c.Type, Text: c.Text, ImageBase64: c.ImageBase64,
				FileUrl: c.FileUrl, FileBase64: c.FileBase64,
				CallId: c.CallId, Name: c.Name, Arguments: c.Arguments,
				Output: c.Output, ImageUrl: c.ImageUrl, MediaType: c.MediaType, Result: c.Result,
				Detail: c.Detail,
			}
			pbContent.Actions = append(pbContent.Actions, c.Actions...)
			pbInput.Content = append(pbInput.Content, pbContent)
		}
		pbReq.Inputs = append(pbReq.Inputs, pbInput)
	}
	return pbReq
}
