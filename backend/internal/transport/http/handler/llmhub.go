package handler

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"

	llmhubsbiz "sico-backend/internal/biz/llmhubs"
	"sico-backend/internal/errcode"
	"sico-backend/internal/shared/apperr"
	dto "sico-backend/internal/transport/http/dto/llmhubs"
)

// sourceSlots enumerates the predefined source slots available for
// request_field_mapping in custom (http_json / http_binary) providers.
var sourceSlots = []gin.H{
	{"value": "input_text", "label": "Input Text", "description": "First text content block"},
	{"value": "input_image", "label": "Input Image (base64)", "description": "First image content block (base64 encoded)"},
	{"value": "input_image_url", "label": "Input Image (URL)", "description": "First image content block (URL)"},
	{"value": "input_file", "label": "Input File", "description": "First file content block (URL or base64)"},
	{"value": "instructions", "label": "Instructions", "description": "Top-level system instructions"},
	{"value": "options.temperature", "label": "Temperature", "description": "Sampling temperature"},
	{"value": "options.max_tokens", "label": "Max Tokens", "description": "Maximum output tokens"},
	{"value": "options.top_p", "label": "Top P", "description": "Nucleus sampling probability"},
	{"value": "options.seed", "label": "Seed", "description": "Random seed for reproducibility"},
	{"value": "options.output_format", "label": "Output Format", "description": "Requested output format"},
}

//go:embed assets/llmhub_sdk_examples.md
var sdkExamplesContent string

func llmhubsService(ctx *gin.Context) (llmhubsbiz.Service, bool) {
	svc := llmhubsbiz.Default()
	if svc == nil {
		internalServerErrorResponse(ctx, apperr.New(errcode.CommonUnavailable, "llmhub service not initialized"))
		return nil, false
	}

	return svc, true
}

// RuntimeGenerate invokes the runtime API for model inference.
// @Router /api/sico/llm/runtime/generate [POST]
// @Tags llmhub
// @Accept json
// @Produce json
// @Param request body dto.RuntimeGenerateRequest true "Runtime Generate"
// @Success 200 {object} dto.RuntimeGenerateResponse
func RuntimeGenerate(ctx *gin.Context) {
	var req dto.RuntimeGenerateRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	svc, ok := llmhubsService(ctx)
	if !ok {
		return
	}

	resp, err := svc.RuntimeGenerate(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// RuntimeGenerateStream invokes the runtime API with server-sent events streaming.
// @Router /api/sico/llm/runtime/generate/stream [POST]
// @Tags llmhub
// @Accept json
// @Produce text/event-stream
// @Param request body dto.RuntimeGenerateRequest true "Runtime Generate"
// @Success 200 {object} dto.RuntimeStreamChunk
func RuntimeGenerateStream(ctx *gin.Context) {
	var req dto.RuntimeGenerateRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	svc, ok := llmhubsService(ctx)
	if !ok {
		return
	}

	flusher, supportsStreaming := ctx.Writer.(http.Flusher)
	if !supportsStreaming {
		internalServerErrorResponse(ctx, apperr.New(
			errcode.CommonUnavailable,
			"streaming is not supported by the current response writer",
		))
		return
	}

	ctx.Writer.Header().Set("Content-Type", "text/event-stream")
	ctx.Writer.Header().Set("Cache-Control", "no-cache")
	ctx.Writer.Header().Set("Connection", "keep-alive")
	ctx.Writer.Header().Set("X-Accel-Buffering", "no")
	ctx.Writer.WriteHeader(http.StatusOK)

	err := svc.RuntimeGenerateStream(reqctx(ctx), &req, func(chunk *dto.RuntimeStreamChunk) error {
		data, marshalErr := json.Marshal(chunk)
		if marshalErr != nil {
			return marshalErr
		}
		_, writeErr := fmt.Fprintf(ctx.Writer, "data: %s\n\n", data)
		if writeErr != nil {
			return writeErr
		}
		flusher.Flush()
		return nil
	})
	if err != nil {
		code := errcode.CommonInternalError
		msg := "internal server error"
		if ae, ok := apperr.As(err); ok {
			code = ae.Code()
			msg = ae.Message()
		}
		errChunk, _ := json.Marshal(dto.RuntimeStreamChunk{
			FinishReason: "error", Code: code, Msg: msg,
		})
		_, _ = fmt.Fprintf(ctx.Writer, "data: %s\n\n", errChunk)
		flusher.Flush()
	}

	_, _ = fmt.Fprintf(ctx.Writer, "data: [DONE]\n\n")
	flusher.Flush()
}

// CreateModelRegistry creates a new custom model registry entry.
// @Router /api/sico/llm/models [POST]
// @Tags llmhub
// @Accept json
// @Produce json
// @Param request body dto.CreateModelRegistryRequest true "Create Model"
// @Success 200 {object} dto.CreateModelRegistryResponse
// @Security BearerAuth
func CreateModelRegistry(ctx *gin.Context) {
	var req dto.CreateModelRegistryRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	svc, ok := llmhubsService(ctx)
	if !ok {
		return
	}

	resp, err := svc.CreateModel(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, resp)
}

// DeleteModelRegistry deletes a model registry entry by ID.
// @Router /api/sico/llm/models [DELETE]
// @Tags llmhub
// @Accept json
// @Produce json
// @Param request body dto.DeleteModelRegistryRequest true "Delete Model"
// @Success 200 {object} dto.DeleteModelRegistryResponse
// @Security BearerAuth
func DeleteModelRegistry(ctx *gin.Context) {
	var req dto.DeleteModelRegistryRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	svc, ok := llmhubsService(ctx)
	if !ok {
		return
	}

	resp, err := svc.DeleteModel(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// SetOrganizationLLMConfig sets the default model for an organization.
// @Router /api/sico/llm/org-config [POST]
// @Tags llmhub
// @Accept json
// @Produce json
// @Param request body dto.SetOrganizationLLMConfigRequest true "Set Org Config"
// @Success 200 {object} dto.SetOrganizationLLMConfigResponse
// @Security BearerAuth
func SetOrganizationLLMConfig(ctx *gin.Context) {
	var req dto.SetOrganizationLLMConfigRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	svc, ok := llmhubsService(ctx)
	if !ok {
		return
	}

	resp, err := svc.SetOrganizationLLMConfig(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// GetOrganizationLLMConfig retrieves the default model config for an organization.
// @Router /api/sico/llm/org-config [GET]
// @Tags llmhub
// @Produce json
// @Param request query dto.GetOrganizationLLMConfigRequest true "Get Org Config"
// @Success 200 {object} dto.GetOrganizationLLMConfigResponse
// @Security BearerAuth
func GetOrganizationLLMConfig(ctx *gin.Context) {
	var req dto.GetOrganizationLLMConfigRequest
	if err := ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	svc, ok := llmhubsService(ctx)
	if !ok {
		return
	}

	resp, err := svc.GetOrganizationLLMConfig(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// GetSdkExamples returns SDK usage examples (curl commands, request/response samples).
// @Router /api/sico/llm/sdk-examples [GET]
// @Tags llmhub
// @Produce json
// @Success 200 {object} map[string]any
// @Security BearerAuth
func GetSdkExamples(ctx *gin.Context) {
	ctx.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"content": sdkExamplesContent,
		},
	})
}

// ListSourceSlots returns the source slots available for request field mapping.
// @Router /api/sico/llm/source-slots [GET]
// @Tags llmhub
// @Produce json
// @Success 200 {object} map[string]any
// @Security BearerAuth
func ListSourceSlots(ctx *gin.Context) {
	ctx.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"slots": sourceSlots,
		},
	})
}
