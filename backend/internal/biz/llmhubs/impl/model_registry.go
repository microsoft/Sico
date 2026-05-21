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
	"regexp"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
	"google.golang.org/protobuf/types/known/structpb"
	"gorm.io/gorm"

	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/errcode"
	agentrepo "sico-backend/internal/store/agent/singleagent/repository"
	registryrepo "sico-backend/internal/store/llmhubs/repository"
	dto "sico-backend/internal/transport/http/dto/llmhubs"
	"sico-backend/internal/transport/http/middleware"
)

// modelTypeIOProfiles maps model_type to the base io_profile.
var modelTypeIOProfiles = map[int32]map[string]any{
	1: { // text
		"input_types":  []string{"text"},
		"output_types": []string{"text"},
	},
	2: { // multimodal
		"input_types":  []string{"text", "image", "file"},
		"output_types": []string{"text", "json"},
	},
	3: { // artifact
		"input_types":  []string{"text", "image", "file"},
		"output_types": []string{"artifact"},
	},
}

// CreateModel creates a new custom model registry entry.
func (s *Service) CreateModel(
	ctx context.Context,
	req *dto.CreateModelRegistryRequest,
) (*dto.CreateModelRegistryResponse, error) {
	if err := validateAuthConfig(req.Auth); err != nil {
		return nil, err
	}
	if err := validateProviderTemplateType(req.ProviderTemplateType); err != nil {
		return nil, err
	}
	if err := validateModelType(req.ModelType); err != nil {
		return nil, err
	}

	modelKey, err := s.generateModelKey(ctx, req.DisplayName)
	if err != nil {
		return nil, apperr.Wrap(errcode.CommonInternalError, "failed to generate model key", err)
	}

	ioProfile, err := buildIOProfile(req.ModelType, req.ProviderTemplateType)
	if err != nil {
		return nil, err
	}

	configWithAuth := injectAuthConfigFields(req.Config, req.Auth)
	normalizedConfig := normalizeProviderConfigStruct(req.ProviderTemplateType, configWithAuth)

	m := &registryrepo.ModelRegistryModel{
		ModelKey:             modelKey,
		DisplayName:          req.DisplayName,
		ModelType:            req.ModelType,
		ProviderTemplateType: req.ProviderTemplateType,
		AgentID:              req.AgentId,
		Status:               statusActive,
		IsBuiltin:            0,
		Description:          req.Description,
		IconURI:              req.IconUri,
		IoProfile:            structToJSON(ioProfile),
		Config:               structToJSON(normalizedConfig),
	}

	if err := validateConfig(m); err != nil {
		return nil, err
	}

	username := usernameFromCtx(ctx)
	m.CreatorUsername = username
	m.UpdaterUsername = username

	if err := s.withRepositories(ctx, func(
		modelRepo registryrepo.ModelRegistryRepository,
		secretRepo registryrepo.ModelRegistrySecretRepository,
		_ agentrepo.SingleAgentLLMHubConfigRepository,
	) error {
		id, createErr := modelRepo.Create(ctx, m)
		if createErr != nil {
			return apperr.Wrap(errcode.CommonInternalError, "failed to create model", createErr)
		}
		m.ID = id
		if saveErr := saveAuthSecretsWithRepo(ctx, secretRepo, id, req.Auth); saveErr != nil {
			return apperr.Wrap(errcode.CommonInternalError, "failed to save model auth secrets", saveErr)
		}
		return nil
	}); err != nil {
		return nil, err
	}

	return &dto.CreateModelRegistryResponse{
		Data: &dto.CreateModelRegistryData{Model: modelToEntry(m)},
	}, nil
}

// ListModels returns paginated model registry entries for a scope.
func (s *Service) ListModels(ctx context.Context, req *dto.ListModelRegistryRequest) (*dto.ListModelRegistryResponse, error) {
	page := req.Page
	pageSize := req.PageSize
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}

	filter := &registryrepo.ModelRegistryFilter{
		AgentID:              req.AgentId,
		Status:               req.Status,
		ProviderTemplateType: req.ProviderTemplateType,
		ModelType:            req.ModelType,
		Keyword:              req.Keyword,
		IsBuiltin:            -1,
		Offset:               int(page-1) * int(pageSize),
		Limit:                int(pageSize),
	}

	list, total, err := s.ModelRegistryRepo.List(ctx, filter)
	if err != nil {
		return nil, apperr.Wrap(errcode.CommonInternalError, "failed to list models", err)
	}

	items := make([]*dto.ModelRegistryEntry, 0, len(list))
	for _, m := range list {
		items = append(items, modelToEntry(m))
	}

	return &dto.ListModelRegistryResponse{
		Data: &dto.ListModelRegistryData{Items: items, Total: total},
	}, nil
}

// DeleteModel removes a custom model and cleans up its references in any agent config.
func (s *Service) DeleteModel(
	ctx context.Context,
	req *dto.DeleteModelRegistryRequest,
) (*dto.DeleteModelRegistryResponse, error) {
	if err := s.withRepositories(ctx, func(
		modelRepo registryrepo.ModelRegistryRepository,
		secretRepo registryrepo.ModelRegistrySecretRepository,
		configRepo agentrepo.SingleAgentLLMHubConfigRepository,
	) error {
		existing, getErr := modelRepo.GetByID(ctx, req.Id)
		if getErr != nil {
			return apperr.New(errcode.CommonNotFound, "model not found")
		}
		if existing.IsBuiltin == 1 {
			return apperr.New(errcode.CommonForbidden, "cannot delete built-in model")
		}
		if err := cleanupDeletedModelFromAgentConfig(ctx, configRepo, existing.AgentID, existing.ModelKey); err != nil {
			return err
		}
		if deleteErr := modelRepo.Delete(ctx, req.Id); deleteErr != nil {
			return apperr.Wrap(errcode.CommonInternalError, "failed to delete model", deleteErr)
		}
		if deleteSecretsErr := secretRepo.DeleteSecrets(ctx, req.Id); deleteSecretsErr != nil {
			return apperr.Wrap(errcode.CommonInternalError, "failed to delete model secrets", deleteSecretsErr)
		}
		return nil
	}); err != nil {
		return nil, err
	}

	return &dto.DeleteModelRegistryResponse{}, nil
}

// ======================================================================
// Helpers
// ======================================================================

var (
	nonAlphanumRegex = regexp.MustCompile(`[^a-z0-9-]+`)
	multiDashRegex   = regexp.MustCompile(`-{2,}`)
)

// generateModelKey creates a URL-safe model_key from display_name.
func (s *Service) generateModelKey(ctx context.Context, displayName string) (string, error) {
	normalized := norm.NFKD.String(displayName)
	var b strings.Builder
	for _, r := range normalized {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(unicode.ToLower(r))
		} else if r == ' ' || r == '-' || r == '_' {
			b.WriteRune('-')
		}
	}
	key := b.String()
	key = nonAlphanumRegex.ReplaceAllString(key, "")
	key = multiDashRegex.ReplaceAllString(key, "-")
	key = strings.Trim(key, "-")
	if key == "" {
		key = "model"
	}
	if len(key) > 120 {
		key = key[:120]
	}

	exists, err := s.ModelRegistryRepo.ExistsByModelKey(ctx, key)
	if err != nil {
		return "", err
	}
	if !exists {
		return key, nil
	}
	return "", apperr.New(errcode.CommonConflict, fmt.Sprintf("model key %q already exists", key))
}

// modelToEntry converts a GORM model to a DTO entry.
func modelToEntry(m *registryrepo.ModelRegistryModel) *dto.ModelRegistryEntry {
	return &dto.ModelRegistryEntry{
		Id:                   m.ID,
		ModelKey:             m.ModelKey,
		DisplayName:          m.DisplayName,
		ModelType:            m.ModelType,
		ProviderTemplateType: m.ProviderTemplateType,
		AgentId:              m.AgentID,
		Status:               m.Status,
		IsBuiltin:            m.IsBuiltin == 1,
		Description:          m.Description,
		IconUri:              m.IconURI,
		IoProfile:            jsonToStruct(m.IoProfile),
		Config:               jsonToStruct(m.Config),
		CreatorUsername:      m.CreatorUsername,
		UpdaterUsername:      m.UpdaterUsername,
		CreatedAt:            m.CreatedAt,
		UpdatedAt:            m.UpdatedAt,
	}
}

var validProviderTemplateTypes = map[int32]struct{}{
	1: {}, // azure_openai
	2: {}, // openai_compatible
	4: {}, // http_json
	5: {}, // http_binary
	6: {}, // anthropic
	7: {}, // gemini
}

func validateProviderTemplateType(t int32) error {
	if _, ok := validProviderTemplateTypes[t]; !ok {
		return apperr.New(errcode.CommonInvalidParam, "invalid provider template type")
	}
	return nil
}

func validateModelType(t int32) error {
	if t < 1 || t > 3 {
		return apperr.New(
			errcode.CommonInvalidParam,
			"invalid model type, must be 1 (text), 2 (multimodal), or 3 (artifact)",
		)
	}
	return nil
}

// buildIOProfile generates the io_profile Struct from model_type and provider capabilities.
func buildIOProfile(modelType int32, providerTemplateType int32) (*structpb.Struct, error) {
	baseProfile, ok := modelTypeIOProfiles[modelType]
	if !ok {
		return nil, apperr.New(errcode.CommonInvalidParam, "unsupported model type")
	}
	profile := make(map[string]any, len(baseProfile)+3)
	for key, value := range baseProfile {
		profile[key] = normalizeStructValue(value)
	}
	profile["supports_tools"] = providerSupportsTools(providerTemplateType)
	profile["supports_previous_response_id"] = providerSupportsPreviousResponseID(providerTemplateType)
	profile["supports_structured_output"] = providerSupportsStructuredOutput(providerTemplateType)
	s, err := structpb.NewStruct(profile)
	if err != nil {
		return nil, apperr.Wrap(errcode.CommonInternalError, "failed to build IO profile", err)
	}
	return s, nil
}

func normalizeStructValue(value any) any {
	switch v := value.(type) {
	case []string:
		items := make([]any, 0, len(v))
		for _, item := range v {
			items = append(items, item)
		}
		return items
	case []any:
		items := make([]any, 0, len(v))
		for _, item := range v {
			items = append(items, normalizeStructValue(item))
		}
		return items
	case map[string]any:
		normalized := make(map[string]any, len(v))
		for key, item := range v {
			normalized[key] = normalizeStructValue(item)
		}
		return normalized
	default:
		return value
	}
}

func providerSupportsTools(t int32) bool              { return t == 1 || t == 2 }
func providerSupportsPreviousResponseID(t int32) bool { return t == 1 || t == 2 }
func providerSupportsStructuredOutput(t int32) bool   { return t == 1 || t == 2 }

// validateConfig checks that required config fields are present for each provider type.
func validateConfig(m *registryrepo.ModelRegistryModel) error {
	if m.Config == "" {
		return apperr.New(errcode.LLMHubInvalidConfig, "config is required")
	}
	cfg := jsonToStruct(m.Config)
	if cfg == nil {
		return apperr.New(errcode.LLMHubInvalidConfig, "config must be valid JSON")
	}
	cfgMap := cfg.AsMap()

	switch m.ProviderTemplateType {
	case 1: // azure_openai
		return validateAzureOpenAIConfig(cfgMap)
	case 2: // openai_compatible
		return validateOpenAICompatibleConfig(cfgMap)
	case 4, 5, 6, 7: // http_json, http_binary, anthropic, gemini
		return validateBaseURLConfig(cfgMap)
	}
	return nil
}

func validateAzureOpenAIConfig(cfgMap map[string]any) error {
	baseURL, _ := cfgMap["base_url"].(string)
	endpoint, _ := cfgMap["endpoint"].(string)
	if baseURL == "" && endpoint == "" {
		return apperr.New(
			errcode.LLMHubInvalidConfig,
			"config.base_url or config.endpoint is required for azure_openai",
		)
	}

	deploymentName, _ := cfgMap["deployment_name"].(string)
	upstreamModelName, _ := cfgMap["upstream_model_name"].(string)
	if strings.TrimSpace(deploymentName) == "" && strings.TrimSpace(upstreamModelName) == "" {
		return apperr.New(
			errcode.LLMHubInvalidConfig,
			"config.deployment_name or config.upstream_model_name is required for azure_openai",
		)
	}

	return nil
}

func validateBaseURLConfig(cfgMap map[string]any) error {
	baseURL, _ := cfgMap["base_url"].(string)
	if baseURL == "" {
		return apperr.New(errcode.LLMHubInvalidConfig, "config.base_url is required for this provider type")
	}

	return nil
}

func validateOpenAICompatibleConfig(cfgMap map[string]any) error {
	if err := validateBaseURLConfig(cfgMap); err != nil {
		return err
	}

	baseURL, _ := cfgMap["base_url"].(string)
	upstreamModelName, _ := cfgMap["upstream_model_name"].(string)
	deploymentName, _ := cfgMap["deployment_name"].(string)
	if strings.TrimSpace(upstreamModelName) == "" && strings.TrimSpace(deploymentName) == "" {
		return apperr.New(
			errcode.LLMHubInvalidConfig,
			"config.upstream_model_name or config.deployment_name is required "+
				"for openai_compatible",
		)
	}

	if isOpenRouterCompatibleBaseURL(baseURL) &&
		strings.TrimSpace(upstreamModelName) != "" && strings.TrimSpace(deploymentName) != "" &&
		strings.TrimSpace(upstreamModelName) != strings.TrimSpace(deploymentName) {
		return apperr.New(
			errcode.LLMHubInvalidConfig,
			"config.upstream_model_name and config.deployment_name must match "+
				"for openrouter openai_compatible models",
		)
	}

	return nil
}

func normalizeProviderConfigStruct(providerTemplateType int32, cfg *structpb.Struct) *structpb.Struct {
	if cfg == nil {
		return nil
	}
	cfgMap := cfg.AsMap()
	if providerTemplateType == 2 {
		baseURL, _ := cfgMap["base_url"].(string)
		upstreamModelName, _ := cfgMap["upstream_model_name"].(string)
		deploymentName, _ := cfgMap["deployment_name"].(string)
		if isOpenRouterCompatibleBaseURL(baseURL) &&
			strings.TrimSpace(upstreamModelName) == "" && strings.TrimSpace(deploymentName) != "" {
			cfgMap["upstream_model_name"] = strings.TrimSpace(deploymentName)
		}
	}
	normalized, err := structpb.NewStruct(cfgMap)
	if err != nil {
		return cfg
	}
	return normalized
}

func isOpenRouterCompatibleBaseURL(baseURL string) bool {
	return strings.Contains(strings.ToLower(strings.TrimSpace(baseURL)), "openrouter.ai")
}

func structToJSON(s *structpb.Struct) string {
	if s == nil {
		return ""
	}
	b, err := s.MarshalJSON()
	if err != nil {
		return ""
	}
	return string(b)
}

func jsonToStruct(s string) *structpb.Struct {
	if s == "" {
		return nil
	}
	st := &structpb.Struct{}
	if err := st.UnmarshalJSON([]byte(s)); err != nil {
		return nil
	}
	return st
}

func validateAuthConfig(auth *dto.AuthConfig) error {
	if auth == nil {
		return nil
	}
	switch auth.AuthType {
	case int32(dto.AuthType_AUTH_TYPE_NONE):
		return nil
	case int32(dto.AuthType_AUTH_TYPE_BEARER_TOKEN):
		if strings.TrimSpace(auth.Token) == "" {
			return apperr.New(errcode.CommonInvalidParam, "token is required when authType is bearer token")
		}
		return nil
	case int32(dto.AuthType_AUTH_TYPE_API_KEY_HEADER):
		if strings.TrimSpace(auth.HeaderName) == "" {
			return apperr.New(errcode.CommonInvalidParam, "headerName is required when authType is api key")
		}
		if strings.TrimSpace(auth.ApiKeyValue) == "" {
			return apperr.New(errcode.CommonInvalidParam, "apiKeyValue is required when authType is api key")
		}
		return nil
	default:
		return apperr.New(errcode.CommonInvalidParam, "invalid authType")
	}
}

func saveAuthSecretsWithRepo(
	ctx context.Context,
	secretRepo registryrepo.ModelRegistrySecretRepository,
	registryID int64,
	auth *dto.AuthConfig,
) error {
	if auth == nil {
		return nil
	}
	var secrets []*registryrepo.ModelRegistrySecretModel
	switch auth.AuthType {
	case int32(dto.AuthType_AUTH_TYPE_BEARER_TOKEN):
		if auth.Token != "" {
			secrets = append(secrets, &registryrepo.ModelRegistrySecretModel{
				SecretKey:   "bearer_token",
				SecretValue: auth.Token,
			})
		}
	case int32(dto.AuthType_AUTH_TYPE_API_KEY_HEADER):
		if auth.ApiKeyValue != "" {
			secrets = append(secrets, &registryrepo.ModelRegistrySecretModel{
				SecretKey:   "api_key_value",
				SecretValue: auth.ApiKeyValue,
			})
		}
	}
	return secretRepo.UpsertSecrets(ctx, registryID, secrets)
}

// injectAuthConfigFields merges non-secret auth metadata (e.g. api key header_name)
// into the config struct so runtime adapters can read it without fetching secrets.
func injectAuthConfigFields(cfg *structpb.Struct, auth *dto.AuthConfig) *structpb.Struct {
	if auth == nil || auth.AuthType != int32(dto.AuthType_AUTH_TYPE_API_KEY_HEADER) {
		return cfg
	}

	headerName := strings.TrimSpace(auth.HeaderName)
	if headerName == "" {
		return cfg
	}

	cfgMap := map[string]any{}
	if cfg != nil {
		cfgMap = cfg.AsMap()
	}
	cfgMap["header_name"] = headerName
	merged, err := structpb.NewStruct(cfgMap)
	if err != nil {
		return cfg
	}

	return merged
}

// cleanupDeletedModelFromAgentConfig removes a deleted model_key from any agent's
// selected models and clears the default global model key if it referenced it.
func cleanupDeletedModelFromAgentConfig(
	ctx context.Context,
	repo agentrepo.SingleAgentLLMHubConfigRepository,
	agentID, deletedModelKey string,
) error {
	if repo == nil {
		return nil
	}
	agentID = strings.TrimSpace(agentID)
	deletedModelKey = strings.ToLower(strings.TrimSpace(deletedModelKey))
	if agentID == "" || deletedModelKey == "" {
		return nil
	}

	config, err := repo.Get(ctx, agentID)
	if err != nil {
		return apperr.Wrap(errcode.CommonInternalError, "failed to load agent llmhub config", err)
	}
	if config == nil {
		return nil
	}

	filteredModelKeys := filterModelKeys(config.ModelKeys, deletedModelKey)
	defaultGlobalModelKey := resolveDefaultGlobalModelKey(config.DefaultGlobalModelKey, deletedModelKey)

	if len(filteredModelKeys) == len(config.ModelKeys) && defaultGlobalModelKey == config.DefaultGlobalModelKey {
		return nil
	}

	if len(filteredModelKeys) == 0 && defaultGlobalModelKey == "" {
		if err := repo.Delete(ctx, agentID); err != nil {
			return apperr.Wrap(errcode.CommonInternalError, "failed to delete agent llmhub config", err)
		}
		return nil
	}

	config.ModelKeys = filteredModelKeys
	config.DefaultGlobalModelKey = defaultGlobalModelKey
	if err := repo.Upsert(ctx, config); err != nil {
		return apperr.Wrap(errcode.CommonInternalError, "failed to save agent llmhub config", err)
	}
	return nil
}

// filterModelKeys returns a normalized copy of keys with blanks and the deleted key removed.
func filterModelKeys(keys []string, deletedModelKey string) []string {
	filtered := make([]string, 0, len(keys))
	for _, key := range keys {
		normalizedKey := strings.ToLower(strings.TrimSpace(key))
		if normalizedKey == "" || normalizedKey == deletedModelKey {
			continue
		}
		filtered = append(filtered, normalizedKey)
	}

	return filtered
}

// resolveDefaultGlobalModelKey returns the normalized default key, clearing it if it
// references the deleted model.
func resolveDefaultGlobalModelKey(current, deletedModelKey string) string {
	normalized := strings.ToLower(strings.TrimSpace(current))
	if normalized == deletedModelKey {
		return ""
	}

	return normalized
}

// usernameFromCtx extracts the username from the auth middleware context.
func usernameFromCtx(ctx context.Context) string {
	u := middleware.GetUsernameFromCtx(ctx)
	if u != nil {
		return *u
	}
	return ""
}

// withRepositories runs fn inside a DB transaction when DB is available, otherwise
// passes the service-level repositories directly.
func (s *Service) withRepositories(
	ctx context.Context,
	fn func(
		modelRepo registryrepo.ModelRegistryRepository,
		secretRepo registryrepo.ModelRegistrySecretRepository,
		configRepo agentrepo.SingleAgentLLMHubConfigRepository,
	) error,
) error {
	if s.DB == nil {
		return fn(s.ModelRegistryRepo, s.ModelRegistrySecretRepo, s.SingleAgentLLMHubConfigRepo)
	}
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return fn(
			registryrepo.NewModelRegistryRepo(tx),
			registryrepo.NewModelRegistrySecretRepo(tx),
			agentrepo.NewSingleAgentLLMHubConfigRepo(tx),
		)
	})
}
