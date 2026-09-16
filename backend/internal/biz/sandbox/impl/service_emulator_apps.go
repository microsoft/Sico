package impl

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/errcode"
	sandboxdto "sico-backend/internal/transport/http/dto/sandbox"
	"sico-backend/internal/transport/http/middleware"
	"sico-backend/pkg/logger"
	"sico-backend/pkg/safego"
)

const (
	emulatorAppFilterUser   = "user"
	emulatorAppFilterSystem = "system"
	emulatorAppFilterAll    = "all"

	emulatorAppStatusPending = "pending"
	emulatorAppStatusRunning = "running"
	emulatorAppStatusSuccess = "success"
	emulatorAppStatusPartial = "partial"
	emulatorAppStatusError   = "error"

	emulatorAppDeviceStatusInstalled   = "installed"
	emulatorAppDeviceStatusUninstalled = "uninstalled"
	emulatorAppDeviceStatusSuccess     = "success"
	emulatorAppDeviceStatusFailed      = "failed"

	emulatorAppMaxParallel             int32 = 10
	emulatorAppInstallTaskTTL                = 30 * time.Minute
	emulatorAppInstallTaskFinalTTL           = 5 * time.Minute
	emulatorAppMutationRunTimeout            = 10 * time.Minute
	emulatorAppInstallTaskStoreTimeout       = 5 * time.Second
	emulatorAppInstallTaskDedupTTL           = emulatorAppMutationRunTimeout
)

type emulatorAppTarget struct {
	sandboxID   string
	baseURL     string
	deviceID    string
	deviceIndex int
	displayName string
}

type emulatorAppTargetGroup struct {
	baseURL string
	targets []*emulatorAppTarget
	byIndex map[int]*emulatorAppTarget
	indices []int
}

type emulatorAppInstallTaskState struct {
	TaskID           string                             `json:"taskId"`
	Status           string                             `json:"status"`
	ErrorMessage     string                             `json:"errorMessage,omitempty"`
	Result           *sandboxdto.EmulatorAppBatchResult `json:"result,omitempty"`
	URL              string                             `json:"url,omitempty"`
	InstanceID       string                             `json:"instanceId,omitempty"`
	SandboxIDs       []string                           `json:"sandboxIds,omitempty"`
	SubmittedAt      int64                              `json:"submittedAt,omitempty"`
	UpdatedAt        int64                              `json:"updatedAt,omitempty"`
	SubmitterUserKey string                             `json:"submitterUserKey,omitempty"`
}

func (s *Service) ListEmulatorApps(
	ctx context.Context,
	req *sandboxdto.EmulatorAppListRequest,
) (*sandboxdto.EmulatorAppBatchResult, error) {
	if req == nil {
		req = &sandboxdto.EmulatorAppListRequest{}
	}

	appFilter, err := normalizeEmulatorAppFilter(req.AppFilter)
	if err != nil {
		return nil, err
	}
	targets, emulator, err := s.resolveEmulatorAppTargets(ctx, req.SandboxIds, req.InstanceId, true)
	if err != nil {
		return nil, err
	}

	result := &sandboxdto.EmulatorAppBatchResult{
		AppFilter:      appFilter,
		TargetCount:    int32(len(targets)),
		RequestedCount: int32(len(targets)),
		Results:        []*sandboxdto.EmulatorAppDeviceResult{},
	}
	if len(targets) == 0 {
		result.Status = emulatorAppStatusSuccess
		return result, nil
	}

	result.Results = runEmulatorAppBatch(
		targets,
		emulatorAppDeviceStatusSuccess,
		"list apps",
		func(baseURL string, indices []int) (*EmulatorAppBatchResponse, error) {
			return emulator.ListAppsBatch(ctx, baseURL, indices, appFilter, emulatorAppMaxParallel)
		},
	)
	summarizeEmulatorAppBatchResult(result, emulatorAppDeviceStatusSuccess)
	return result, nil
}

func (s *Service) SubmitInstallEmulatorApp(
	ctx context.Context,
	req *sandboxdto.EmulatorAppInstallRequest,
) (*sandboxdto.EmulatorAppTaskResult, error) {
	appURL, targets, _, err := s.prepareEmulatorAppInstall(ctx, req)
	if err != nil {
		return nil, err
	}

	submitter, authenticated := middleware.GetUserFromContext(ctx)
	if !authenticated {
		return nil, apperr.New(errcode.CommonUnauthorized, "authentication required")
	}

	rds := s.emulatorAppTaskRedis()
	if rds == nil {
		return nil, apperr.New(errcode.CommonUnavailable, "emulator app task store unavailable")
	}

	submitterKey := emulatorAppTaskSubmitterKey(ctx)
	normalizedSandboxIDs := normalizeEmulatorAppSandboxIDs(req.SandboxIds)
	sort.Strings(normalizedSandboxIDs)
	normalizedInstanceID := strings.TrimSpace(req.InstanceId)
	dedupKey := emulatorAppInstallDedupKey(submitterKey, normalizedInstanceID, normalizedSandboxIDs, appURL)
	taskID := uuid.NewString()
	now := time.Now().Unix()
	state := &emulatorAppInstallTaskState{
		TaskID:           taskID,
		Status:           emulatorAppStatusPending,
		URL:              appURL,
		InstanceID:       normalizedInstanceID,
		SandboxIDs:       normalizedSandboxIDs,
		SubmittedAt:      now,
		UpdatedAt:        now,
		SubmitterUserKey: submitterKey,
	}
	if err := s.saveEmulatorAppInstallTask(ctx, state); err != nil {
		return nil, err
	}

	if winner := s.tryReserveEmulatorAppInstallDedup(ctx, dedupKey, taskID); winner != "" && winner != taskID {
		if existing, loadErr := s.loadEmulatorAppInstallTask(ctx, winner); loadErr == nil && existing != nil {
			if deleteErr := rds.Del(ctx, emulatorAppInstallTaskKey(taskID)).Err(); deleteErr != nil {
				logger.Warn(
					"failed to delete orphan emulator app install task task_id=%s err=%v",
					taskID,
					deleteErr,
				)
			}
			return emulatorAppTaskStateResult(existing), nil
		}
	}

	reqCopy := &sandboxdto.EmulatorAppInstallRequest{
		SandboxIds: append([]string(nil), req.SandboxIds...),
		InstanceId: req.InstanceId,
		Url:        req.Url,
	}
	originalTargets := snapshotEmulatorAppTargets(targets)
	response := emulatorAppTaskStateResult(state)

	safego.Go(context.Background(), func() {
		s.runInstallEmulatorAppTask(state, reqCopy, originalTargets, dedupKey, submitter)
	})
	return response, nil
}

func (s *Service) GetEmulatorAppInstallTask(
	ctx context.Context,
	taskID string,
) (*sandboxdto.EmulatorAppTaskResult, error) {
	taskID = strings.TrimSpace(taskID)
	if _, err := uuid.Parse(taskID); err != nil {
		return nil, apperr.New(errcode.CommonInvalidParam, "invalid task_id")
	}
	state, err := s.loadEmulatorAppInstallTask(ctx, taskID)
	if err != nil {
		return nil, err
	}
	if state.SubmitterUserKey != "" {
		callerKey := emulatorAppTaskSubmitterKey(ctx)
		if callerKey == "" || callerKey != state.SubmitterUserKey {
			return nil, apperr.New(errcode.CommonNotFound, "emulator app task not found")
		}
	}
	return emulatorAppTaskStateResult(state), nil
}

func (s *Service) prepareEmulatorAppInstall(
	ctx context.Context,
	req *sandboxdto.EmulatorAppInstallRequest,
) (string, []*emulatorAppTarget, EmulatorAppProvider, error) {
	if req == nil {
		return "", nil, nil, apperr.New(errcode.CommonInvalidParam, "request is required")
	}
	appURL, err := s.resolveEmulatorAppInstallURL(ctx, req.Url)
	if err != nil {
		return "", nil, nil, err
	}
	targets, emulator, err := s.resolveEmulatorAppTargets(ctx, req.SandboxIds, req.InstanceId, false)
	if err != nil {
		return "", nil, nil, err
	}
	if len(targets) == 0 {
		return "", nil, nil, apperr.New(errcode.CommonNotFound, "no emulator app targets found")
	}
	return appURL, targets, emulator, nil
}

func installEmulatorAppTargets(
	ctx context.Context,
	emulator EmulatorAppProvider,
	targets []*emulatorAppTarget,
	appURL string,
) *sandboxdto.EmulatorAppBatchResult {
	result := &sandboxdto.EmulatorAppBatchResult{
		Url:            appURL,
		TargetCount:    int32(len(targets)),
		RequestedCount: int32(len(targets)),
		Results:        []*sandboxdto.EmulatorAppDeviceResult{},
	}
	result.Results = runEmulatorAppBatch(
		targets,
		emulatorAppDeviceStatusInstalled,
		"install app from URL",
		func(baseURL string, indices []int) (*EmulatorAppBatchResponse, error) {
			return emulator.InstallAppBatch(ctx, baseURL, indices, appURL, emulatorAppMaxParallel)
		},
	)
	result.InstalledCount = summarizeEmulatorAppBatchResult(result, emulatorAppDeviceStatusInstalled)
	return result
}

func (s *Service) runInstallEmulatorAppTask(
	state *emulatorAppInstallTaskState,
	req *sandboxdto.EmulatorAppInstallRequest,
	originalTargets map[string]struct{},
	dedupKey string,
	submitter middleware.UserInfo,
) {
	defer func() {
		if recovered := recover(); recovered != nil {
			errMsg := fmt.Sprintf("emulator app install task panicked: %v", recovered)
			s.finalizeEmulatorAppInstallTask(state, emulatorAppStatusError, errMsg, nil, dedupKey)
			panic(recovered)
		}
	}()

	state.Status = emulatorAppStatusRunning
	state.UpdatedAt = time.Now().Unix()
	if err := s.saveEmulatorAppInstallTaskInBackground(state); err != nil {
		logger.Warn("failed to store emulator app install task running state task_id=%s err=%v", state.TaskID, err)
	}

	runCtx, cancel := context.WithTimeout(context.Background(), emulatorAppMutationRunTimeout)
	defer cancel()
	runCtx = context.WithValue(runCtx, middleware.ContextUserKey, submitter)
	appURL, err := s.resolveEmulatorAppInstallURL(runCtx, req.Url)
	if err != nil {
		s.finalizeEmulatorAppInstallTask(
			state,
			emulatorAppStatusError,
			"validation failed before install: "+err.Error(),
			nil,
			dedupKey,
		)
		return
	}

	var result *sandboxdto.EmulatorAppBatchResult
	err = s.withLockedEmulatorAppTargets(
		runCtx,
		req.SandboxIds,
		req.InstanceId,
		originalTargets,
		func(emulator EmulatorAppProvider, currentTargets []*emulatorAppTarget) {
			result = installEmulatorAppTargets(runCtx, emulator, currentTargets, appURL)
		},
	)
	if err != nil {
		s.finalizeEmulatorAppInstallTask(
			state,
			emulatorAppStatusError,
			"validation failed before install: "+err.Error(),
			nil,
			dedupKey,
		)
		return
	}
	status := strings.TrimSpace(result.Status)
	if status == "" {
		status = emulatorAppStatusError
	}
	s.finalizeEmulatorAppInstallTask(state, status, "", result, dedupKey)
}

func (s *Service) finalizeEmulatorAppInstallTask(
	state *emulatorAppInstallTaskState,
	status string,
	errorMessage string,
	result *sandboxdto.EmulatorAppBatchResult,
	dedupKey string,
) {
	state.Status = status
	state.ErrorMessage = errorMessage
	if result != nil {
		state.Result = result
	}
	state.UpdatedAt = time.Now().Unix()

	ctx, cancel := context.WithTimeout(context.Background(), emulatorAppInstallTaskStoreTimeout)
	defer cancel()
	if err := s.saveFinalEmulatorAppInstallTask(ctx, state, dedupKey); err != nil {
		logger.Warn(
			"failed to finalize emulator app install task task_id=%s status=%s err=%v",
			state.TaskID,
			status,
			err,
		)
	}
}

func (s *Service) emulatorAppTaskRedis() *redis.Client {
	if s == nil || s.Pool == nil {
		return nil
	}
	return s.Pool.GetRedis()
}

func (s *Service) saveEmulatorAppInstallTaskInBackground(state *emulatorAppInstallTaskState) error {
	ctx, cancel := context.WithTimeout(context.Background(), emulatorAppInstallTaskStoreTimeout)
	defer cancel()
	return s.saveEmulatorAppInstallTask(ctx, state)
}

func (s *Service) saveEmulatorAppInstallTask(
	ctx context.Context,
	state *emulatorAppInstallTaskState,
) error {
	return s.saveEmulatorAppInstallTaskWithTTL(ctx, state, emulatorAppInstallTaskTTL)
}

func (s *Service) saveEmulatorAppInstallTaskWithTTL(
	ctx context.Context,
	state *emulatorAppInstallTaskState,
	ttl time.Duration,
) error {
	if state == nil || strings.TrimSpace(state.TaskID) == "" {
		return apperr.New(errcode.CommonInvalidParam, "task_id is required")
	}
	rds := s.emulatorAppTaskRedis()
	if rds == nil {
		return apperr.New(errcode.CommonUnavailable, "emulator app task store unavailable")
	}
	payload, err := json.Marshal(state)
	if err != nil {
		return err
	}
	if err := rds.Set(ctx, emulatorAppInstallTaskKey(state.TaskID), string(payload), ttl).Err(); err != nil {
		return apperr.Wrap(errcode.CommonUnavailable, "emulator app task store unavailable", err)
	}
	return nil
}

func (s *Service) saveFinalEmulatorAppInstallTask(
	ctx context.Context,
	state *emulatorAppInstallTaskState,
	dedupKey string,
) error {
	if state == nil || strings.TrimSpace(state.TaskID) == "" {
		return apperr.New(errcode.CommonInvalidParam, "task_id is required")
	}
	rds := s.emulatorAppTaskRedis()
	if rds == nil {
		return apperr.New(errcode.CommonUnavailable, "emulator app task store unavailable")
	}
	payload, err := json.Marshal(state)
	if err != nil {
		return err
	}
	pipe := rds.TxPipeline()
	pipe.Set(ctx, emulatorAppInstallTaskKey(state.TaskID), string(payload), emulatorAppInstallTaskFinalTTL)
	if dedupKey != "" {
		pipe.Del(ctx, dedupKey)
	}
	if _, err := pipe.Exec(ctx); err != nil {
		return apperr.Wrap(errcode.CommonUnavailable, "emulator app task store unavailable", err)
	}
	return nil
}

func (s *Service) loadEmulatorAppInstallTask(
	ctx context.Context,
	taskID string,
) (*emulatorAppInstallTaskState, error) {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return nil, apperr.New(errcode.CommonInvalidParam, "task_id is required")
	}
	rds := s.emulatorAppTaskRedis()
	if rds == nil {
		return nil, apperr.New(errcode.CommonUnavailable, "emulator app task store unavailable")
	}
	value, err := rds.Get(ctx, emulatorAppInstallTaskKey(taskID)).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, apperr.New(errcode.CommonNotFound, "emulator app task not found")
		}
		return nil, apperr.Wrap(errcode.CommonUnavailable, "emulator app task store unavailable", err)
	}
	var state emulatorAppInstallTaskState
	if err := json.Unmarshal([]byte(value), &state); err != nil {
		return nil, err
	}
	if state.TaskID == "" {
		state.TaskID = taskID
	}
	return &state, nil
}

func emulatorAppTaskStateResult(state *emulatorAppInstallTaskState) *sandboxdto.EmulatorAppTaskResult {
	if state == nil {
		return nil
	}
	return &sandboxdto.EmulatorAppTaskResult{
		TaskId:       state.TaskID,
		Status:       state.Status,
		ErrorMessage: state.ErrorMessage,
		Result:       state.Result,
		Url:          state.URL,
		InstanceId:   state.InstanceID,
		SandboxIds:   append([]string(nil), state.SandboxIDs...),
		SubmittedAt:  state.SubmittedAt,
		UpdatedAt:    state.UpdatedAt,
	}
}

func emulatorAppInstallTaskKey(taskID string) string {
	return sandboxRedisPrefix() + "emulator:apps:install:task:" + strings.TrimSpace(taskID)
}

func emulatorAppTaskSubmitterKey(ctx context.Context) string {
	user, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		return ""
	}
	if name := strings.TrimSpace(user.Name); name != "" && name != "SYSTEM" {
		return "name:" + name
	}
	return ""
}

func emulatorAppInstallDedupKey(
	submitterKey string,
	instanceID string,
	sandboxIDs []string,
	appURL string,
) string {
	raw := strings.Join(
		[]string{submitterKey, instanceID, strings.Join(sandboxIDs, ","), strings.TrimSpace(appURL)},
		"|",
	)
	hash := sha256.Sum256([]byte(raw))
	return sandboxRedisPrefix() + "emulator:apps:install:dedup:" + hex.EncodeToString(hash[:])
}

func (s *Service) tryReserveEmulatorAppInstallDedup(ctx context.Context, dedupKey, taskID string) string {
	if dedupKey == "" {
		return ""
	}
	rds := s.emulatorAppTaskRedis()
	if rds == nil {
		return ""
	}
	err := rds.SetArgs(ctx, dedupKey, taskID, redis.SetArgs{
		Mode: "NX",
		TTL:  emulatorAppInstallTaskDedupTTL,
	}).Err()
	if err == nil {
		return taskID
	}
	if !errors.Is(err, redis.Nil) {
		logger.Warn("emulator app install dedup reserve failed: %v", err)
		return ""
	}
	existing, err := rds.Get(ctx, dedupKey).Result()
	if err != nil {
		if !errors.Is(err, redis.Nil) {
			logger.Warn("emulator app install dedup read failed: %v", err)
		}
		return ""
	}
	return existing
}

func snapshotEmulatorAppTargets(targets []*emulatorAppTarget) map[string]struct{} {
	result := make(map[string]struct{}, len(targets))
	for _, target := range targets {
		if target != nil {
			result[target.sandboxID] = struct{}{}
		}
	}
	return result
}

func filterEmulatorAppTargets(
	original map[string]struct{},
	current []*emulatorAppTarget,
) (effective []*emulatorAppTarget, missing []string) {
	currentByID := make(map[string]*emulatorAppTarget, len(current))
	for _, target := range current {
		if target != nil {
			currentByID[target.sandboxID] = target
		}
	}
	for sandboxID := range original {
		if target, ok := currentByID[sandboxID]; ok {
			effective = append(effective, target)
		} else {
			missing = append(missing, sandboxID)
		}
	}
	sort.Slice(effective, func(i, j int) bool {
		return effective[i].sandboxID < effective[j].sandboxID
	})
	return effective, missing
}

func (s *Service) UninstallEmulatorApp(
	ctx context.Context,
	req *sandboxdto.EmulatorAppUninstallRequest,
) (*sandboxdto.EmulatorAppBatchResult, error) {
	if req == nil {
		return nil, apperr.New(errcode.CommonInvalidParam, "request is required")
	}
	packageName := strings.TrimSpace(req.Package)
	if packageName == "" {
		return nil, apperr.New(errcode.CommonInvalidParam, "package is required")
	}
	targets, _, err := s.resolveEmulatorAppTargets(ctx, req.SandboxIds, req.InstanceId, false)
	if err != nil {
		return nil, err
	}
	if len(targets) == 0 {
		return nil, apperr.New(errcode.CommonNotFound, "no emulator app targets found")
	}

	operationContext, cancel := context.WithTimeout(ctx, emulatorAppMutationRunTimeout)
	defer cancel()
	var result *sandboxdto.EmulatorAppBatchResult
	err = s.withLockedEmulatorAppTargets(
		operationContext,
		req.SandboxIds,
		req.InstanceId,
		snapshotEmulatorAppTargets(targets),
		func(emulator EmulatorAppProvider, currentTargets []*emulatorAppTarget) {
			result = &sandboxdto.EmulatorAppBatchResult{
				Package:        packageName,
				TargetCount:    int32(len(currentTargets)),
				RequestedCount: int32(len(currentTargets)),
				Results:        []*sandboxdto.EmulatorAppDeviceResult{},
			}
			result.Results = runEmulatorAppBatch(
				currentTargets,
				emulatorAppDeviceStatusUninstalled,
				"uninstall app",
				func(baseURL string, indices []int) (*EmulatorAppBatchResponse, error) {
					return emulator.UninstallAppBatch(
						operationContext,
						baseURL,
						indices,
						packageName,
						emulatorAppMaxParallel,
					)
				},
			)
			result.UninstalledCount = summarizeEmulatorAppBatchResult(
				result,
				emulatorAppDeviceStatusUninstalled,
			)
		},
	)
	return result, err
}
