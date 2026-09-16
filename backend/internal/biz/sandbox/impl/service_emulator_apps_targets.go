package impl

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/enum"
	"sico-backend/internal/shared/errcode"
	sandboxdto "sico-backend/internal/transport/http/dto/sandbox"
)

func (s *Service) resolveEmulatorAppTargets(
	ctx context.Context,
	sandboxIDs []string,
	instanceID string,
	allowAll bool,
) ([]*emulatorAppTarget, EmulatorAppProvider, error) {
	if s == nil || s.Pool == nil {
		return nil, nil, apperr.New(errcode.SandboxProviderUnavailable, "sandbox service unavailable")
	}
	emulator, err := s.emulatorProviderForAppManagement()
	if err != nil {
		return nil, nil, err
	}

	normalizedSandboxIDs := normalizeEmulatorAppSandboxIDs(sandboxIDs)
	instanceID = strings.TrimSpace(instanceID)
	if len(normalizedSandboxIDs) > 0 && instanceID != "" {
		return nil, nil, apperr.New(
			errcode.CommonInvalidParam,
			"sandbox_ids and instance_id cannot be used together",
		)
	}
	if len(normalizedSandboxIDs) == 0 && instanceID == "" && !allowAll {
		return nil, nil, apperr.New(
			errcode.CommonInvalidParam,
			"sandbox_ids or instance_id is required",
		)
	}

	scopes, err := s.resolveSandboxAuthorizationScopes(ctx)
	if err != nil {
		return nil, nil, err
	}

	targets, filterDenied, err := s.resolveRequestedEmulatorAppTargets(
		ctx,
		emulator,
		normalizedSandboxIDs,
		instanceID,
		scopes,
	)
	if err != nil {
		return nil, nil, err
	}
	targets, err = s.authorizeEmulatorAppTargets(ctx, targets, filterDenied, scopes)
	return targets, emulator, err
}

func (s *Service) resolveRequestedEmulatorAppTargets(
	ctx context.Context,
	emulator EmulatorAppProvider,
	sandboxIDs []string,
	instanceID string,
	scopes *sandboxAuthorizationScopes,
) ([]*emulatorAppTarget, bool, error) {
	if instanceID != "" {
		if _, _, err := s.authorizeInstanceOperationForScopes(ctx, instanceID, true, false, scopes); err != nil {
			return nil, false, err
		}
		targets, err := s.resolveEmulatorAppTargetsByInstance(ctx, emulator, instanceID)
		return targets, false, err
	}
	if len(sandboxIDs) > 0 {
		targets, err := s.resolveEmulatorAppTargetsBySandboxID(ctx, emulator, sandboxIDs)
		return targets, false, err
	}
	targets, err := s.resolveAllEmulatorAppTargets(ctx, emulator)
	return targets, true, err
}

func (s *Service) authorizeEmulatorAppTargets(
	ctx context.Context,
	targets []*emulatorAppTarget,
	filterDenied bool,
	scopes *sandboxAuthorizationScopes,
) ([]*emulatorAppTarget, error) {
	authorized := make([]*emulatorAppTarget, 0, len(targets))
	for _, target := range targets {
		if target == nil {
			continue
		}
		if err := s.authorizeSandboxOperationForScopes(ctx, target.sandboxID, true, scopes); err != nil {
			if filterDenied && isUnavailableEmulatorAppTarget(err) {
				continue
			}
			return nil, err
		}
		authorized = append(authorized, target)
	}
	return authorized, nil
}

func isUnavailableEmulatorAppTarget(err error) bool {
	appError, ok := apperr.As(err)
	return ok && (appError.Code() == errcode.CommonForbidden || appError.Code() == errcode.CommonNotFound)
}

func (s *Service) withLockedEmulatorAppTargets(
	ctx context.Context,
	sandboxIDs []string,
	instanceID string,
	originalTargets map[string]struct{},
	operation func(EmulatorAppProvider, []*emulatorAppTarget),
) error {
	lockIDs := make([]string, 0, len(originalTargets))
	for sandboxID := range originalTargets {
		lockIDs = append(lockIDs, sandboxID)
	}

	return s.withSandboxOperationLocksFor(ctx, lockIDs, emulatorAppOperationLockTTL, func() error {
		currentTargets, emulator, err := s.resolveEmulatorAppTargets(ctx, sandboxIDs, instanceID, false)
		if err != nil {
			return err
		}
		effectiveTargets, missing := filterEmulatorAppTargets(originalTargets, currentTargets)
		if len(missing) > 0 {
			sort.Strings(missing)
			return apperr.New(
				errcode.CommonConflict,
				"sandbox assignment changed before operation started: "+strings.Join(missing, ","),
			)
		}
		operation(emulator, effectiveTargets)
		return nil
	})
}

func (s *Service) emulatorProviderForAppManagement() (EmulatorAppProvider, error) {
	provider, ok := s.Pool.GetProvider(enum.SandboxTypeEmulator.String())
	if !ok || provider == nil {
		return nil, apperr.New(errcode.SandboxProviderUnavailable, "emulator provider not available")
	}
	emulator, ok := provider.(EmulatorAppProvider)
	if !ok {
		return nil, apperr.New(
			errcode.SandboxProviderUnavailable,
			"emulator provider does not support app management",
		)
	}
	return emulator, nil
}

func (s *Service) resolveEmulatorAppTargetsByInstance(
	ctx context.Context,
	emulator EmulatorAppProvider,
	instanceID string,
) ([]*emulatorAppTarget, error) {
	leases, err := s.loadAssignedLeasesBestEffort(ctx, instanceID)
	if err != nil {
		return nil, err
	}
	targets := make([]*emulatorAppTarget, 0, len(leases))
	for _, lease := range leases {
		if lease == nil || lease.Type != enum.SandboxTypeEmulator.String() {
			continue
		}
		target, err := buildEmulatorAppTarget(
			emulator,
			lease.SandboxID,
			lease.ResourceID,
			s.getLeaseDisplayName(ctx, lease),
		)
		if err != nil {
			return nil, err
		}
		targets = append(targets, target)
	}
	return dedupeEmulatorAppTargets(targets), nil
}

func (s *Service) resolveEmulatorAppTargetsBySandboxID(
	ctx context.Context,
	emulator EmulatorAppProvider,
	sandboxIDs []string,
) ([]*emulatorAppTarget, error) {
	resolvedByID := make(map[string]*emulatorAppTarget, len(sandboxIDs))
	for _, sandboxID := range sandboxIDs {
		target, found, err := s.resolveEmulatorAppTargetFromLease(ctx, emulator, sandboxID)
		if err != nil {
			return nil, err
		}
		if found {
			resolvedByID[sandboxID] = target
		}
	}

	targets := make([]*emulatorAppTarget, 0, len(sandboxIDs))
	for _, sandboxID := range sandboxIDs {
		target := resolvedByID[sandboxID]
		if target == nil {
			return nil, apperr.New(
				errcode.CommonNotFound,
				"emulator sandbox is not assigned: "+sandboxID,
			)
		}
		targets = append(targets, target)
	}
	return targets, nil
}

func (s *Service) resolveEmulatorAppTargetFromLease(
	ctx context.Context,
	emulator EmulatorAppProvider,
	sandboxID string,
) (*emulatorAppTarget, bool, error) {
	lease, err := s.Pool.GetSandboxByID(ctx, sandboxID)
	if err != nil {
		if isSandboxLeaseNotFound(err) {
			return nil, false, nil
		}
		return nil, false, err
	}
	if lease == nil {
		return nil, false, nil
	}
	if lease.Type != enum.SandboxTypeEmulator.String() {
		return nil, false, apperr.New(
			errcode.CommonInvalidParam,
			"sandbox_id is not an emulator sandbox: "+sandboxID,
		)
	}
	target, err := buildEmulatorAppTarget(
		emulator,
		lease.SandboxID,
		lease.ResourceID,
		s.getLeaseDisplayName(ctx, lease),
	)
	if err != nil {
		return nil, false, err
	}
	return target, true, nil
}

func (s *Service) resolveAllEmulatorAppTargets(
	ctx context.Context,
	emulator EmulatorAppProvider,
) ([]*emulatorAppTarget, error) {
	listResult, err := s.Pool.ListResources(ctx, enum.SandboxTypeEmulator.String())
	if err != nil {
		return nil, err
	}
	targets := make([]*emulatorAppTarget, 0, len(listResult.Resources))
	for _, resource := range listResult.Resources {
		if resource == nil || resource.Type != enum.SandboxTypeEmulator.String() || resource.ResourceId == "" {
			continue
		}
		sandboxID := resource.SandboxId
		if sandboxID == "" {
			sandboxID = resource.Type + ":" + resource.ResourceId
		}
		target, err := buildEmulatorAppTarget(
			emulator,
			sandboxID,
			resource.ResourceId,
			resource.DisplayName,
		)
		if err != nil {
			return nil, err
		}
		targets = append(targets, target)
	}
	sort.Slice(targets, func(i, j int) bool {
		if targets[i].baseURL != targets[j].baseURL {
			return targets[i].baseURL < targets[j].baseURL
		}
		return targets[i].deviceIndex < targets[j].deviceIndex
	})
	return dedupeEmulatorAppTargets(targets), nil
}

func buildEmulatorAppTarget(
	emulator EmulatorAppProvider,
	sandboxID string,
	resourceID string,
	displayName string,
) (*emulatorAppTarget, error) {
	sandboxID = strings.TrimSpace(sandboxID)
	resourceID = strings.TrimSpace(resourceID)
	if sandboxID == "" || resourceID == "" {
		return nil, apperr.New(errcode.CommonInvalidParam, "sandbox_id and resource_id are required")
	}
	baseURL, deviceID, err := emulator.ParseResourceIDForProxy(resourceID)
	if err != nil {
		return nil, err
	}
	deviceIndex, err := strconv.Atoi(deviceID)
	if err != nil {
		return nil, apperr.New(errcode.CommonInvalidParam, "invalid emulator device id: "+deviceID)
	}
	if strings.TrimSpace(displayName) == "" {
		displayName = fmt.Sprintf("Android Device #%s", deviceID)
	}
	return &emulatorAppTarget{
		sandboxID:   sandboxID,
		baseURL:     strings.TrimRight(baseURL, "/"),
		deviceID:    deviceID,
		deviceIndex: deviceIndex,
		displayName: displayName,
	}, nil
}

func runEmulatorAppBatch(
	targets []*emulatorAppTarget,
	successStatus string,
	operation string,
	call func(baseURL string, indices []int) (*EmulatorAppBatchResponse, error),
) []*sandboxdto.EmulatorAppDeviceResult {
	resultsBySandboxID := make(map[string]*sandboxdto.EmulatorAppDeviceResult, len(targets))
	for _, group := range groupEmulatorAppTargets(targets) {
		response, err := call(group.baseURL, group.indices)
		if err != nil {
			markEmulatorAppGroupFailed(resultsBySandboxID, group, err.Error())
			continue
		}
		if response == nil {
			markEmulatorAppGroupFailed(resultsBySandboxID, group, "emulator response is empty")
			continue
		}
		applyEmulatorAppUpstreamResults(resultsBySandboxID, group, response.Results, successStatus)
		fillMissingEmulatorAppGroupResults(resultsBySandboxID, group, operation)
	}
	return orderEmulatorAppResults(targets, resultsBySandboxID)
}

func markEmulatorAppGroupFailed(
	results map[string]*sandboxdto.EmulatorAppDeviceResult,
	group emulatorAppTargetGroup,
	message string,
) {
	for _, target := range group.targets {
		results[target.sandboxID] = failedEmulatorAppDeviceResult(target, message)
	}
}

func applyEmulatorAppUpstreamResults(
	results map[string]*sandboxdto.EmulatorAppDeviceResult,
	group emulatorAppTargetGroup,
	upstreamResults []EmulatorAppBatchDeviceResult,
	successStatus string,
) {
	for _, upstream := range upstreamResults {
		target := group.byIndex[upstream.Index]
		if target == nil {
			continue
		}
		results[target.sandboxID] = emulatorAppDeviceResultFromBatch(target, upstream, successStatus)
	}
}

func fillMissingEmulatorAppGroupResults(
	results map[string]*sandboxdto.EmulatorAppDeviceResult,
	group emulatorAppTargetGroup,
	operation string,
) {
	for _, target := range group.targets {
		if results[target.sandboxID] == nil {
			message := fmt.Sprintf("emulator response missing %s result for device %s", operation, target.deviceID)
			results[target.sandboxID] = failedEmulatorAppDeviceResult(target, message)
		}
	}
}

func orderEmulatorAppResults(
	targets []*emulatorAppTarget,
	results map[string]*sandboxdto.EmulatorAppDeviceResult,
) []*sandboxdto.EmulatorAppDeviceResult {
	ordered := make([]*sandboxdto.EmulatorAppDeviceResult, 0, len(targets))
	for _, target := range targets {
		result := results[target.sandboxID]
		if result == nil {
			result = failedEmulatorAppDeviceResult(target, "emulator operation result missing")
		}
		ordered = append(ordered, result)
	}
	return ordered
}

func emulatorAppDeviceResultFromBatch(
	target *emulatorAppTarget,
	upstream EmulatorAppBatchDeviceResult,
	defaultStatus string,
) *sandboxdto.EmulatorAppDeviceResult {
	status := strings.TrimSpace(upstream.Status)
	if status == "" {
		status = defaultStatus
	}
	return &sandboxdto.EmulatorAppDeviceResult{
		SandboxId:    target.sandboxID,
		DeviceId:     target.deviceID,
		DisplayName:  target.displayName,
		Serial:       upstream.Serial,
		Status:       status,
		Apps:         convertEmulatorAppInfos(upstream.Apps),
		Package:      upstream.Package,
		ErrorMessage: upstream.ErrorMessage,
		ErrorCode:    upstream.ErrorCode,
	}
}

func convertEmulatorAppInfos(in []*EmulatorAppInfoUpstream) []*sandboxdto.EmulatorAppInfo {
	if len(in) == 0 {
		return nil
	}
	out := make([]*sandboxdto.EmulatorAppInfo, 0, len(in))
	for _, app := range in {
		if app == nil {
			continue
		}
		out = append(out, &sandboxdto.EmulatorAppInfo{
			Package:  app.Package,
			AppName:  app.AppName,
			Version:  app.Version,
			IsSystem: app.IsSystem,
		})
	}
	return out
}

func failedEmulatorAppDeviceResult(
	target *emulatorAppTarget,
	message string,
) *sandboxdto.EmulatorAppDeviceResult {
	return &sandboxdto.EmulatorAppDeviceResult{
		SandboxId:    target.sandboxID,
		DeviceId:     target.deviceID,
		DisplayName:  target.displayName,
		Status:       emulatorAppDeviceStatusFailed,
		ErrorMessage: message,
	}
}

func summarizeEmulatorAppBatchResult(
	result *sandboxdto.EmulatorAppBatchResult,
	successStatus string,
) int32 {
	var succeeded int32
	var failed int32
	for _, item := range result.Results {
		if item != nil && item.Status == successStatus {
			succeeded++
		} else {
			failed++
		}
	}
	result.SucceededCount = succeeded
	result.FailedCount = failed
	result.Status = emulatorAppStatusSuccess
	if failed > 0 && succeeded > 0 {
		result.Status = emulatorAppStatusPartial
	} else if failed > 0 {
		result.Status = emulatorAppStatusError
	}
	return succeeded
}

func groupEmulatorAppTargets(targets []*emulatorAppTarget) []emulatorAppTargetGroup {
	groupsByBaseURL := make(map[string]*emulatorAppTargetGroup)
	baseURLOrder := make([]string, 0)
	for _, target := range targets {
		if target == nil {
			continue
		}
		group := groupsByBaseURL[target.baseURL]
		if group == nil {
			group = &emulatorAppTargetGroup{
				baseURL: target.baseURL,
				byIndex: make(map[int]*emulatorAppTarget),
			}
			groupsByBaseURL[target.baseURL] = group
			baseURLOrder = append(baseURLOrder, target.baseURL)
		}
		group.targets = append(group.targets, target)
		group.indices = append(group.indices, target.deviceIndex)
		group.byIndex[target.deviceIndex] = target
	}
	groups := make([]emulatorAppTargetGroup, 0, len(baseURLOrder))
	for _, baseURL := range baseURLOrder {
		groups = append(groups, *groupsByBaseURL[baseURL])
	}
	return groups
}

func dedupeEmulatorAppTargets(targets []*emulatorAppTarget) []*emulatorAppTarget {
	seen := make(map[string]struct{}, len(targets))
	out := make([]*emulatorAppTarget, 0, len(targets))
	for _, target := range targets {
		if target == nil || target.sandboxID == "" {
			continue
		}
		if _, ok := seen[target.sandboxID]; ok {
			continue
		}
		seen[target.sandboxID] = struct{}{}
		out = append(out, target)
	}
	return out
}

func normalizeEmulatorAppSandboxIDs(sandboxIDs []string) []string {
	seen := make(map[string]struct{}, len(sandboxIDs))
	out := make([]string, 0, len(sandboxIDs))
	for _, sandboxID := range sandboxIDs {
		sandboxID = strings.TrimSpace(sandboxID)
		if sandboxID == "" {
			continue
		}
		if _, ok := seen[sandboxID]; ok {
			continue
		}
		seen[sandboxID] = struct{}{}
		out = append(out, sandboxID)
	}
	return out
}

func normalizeEmulatorAppFilter(appFilter string) (string, error) {
	appFilter = strings.TrimSpace(appFilter)
	if appFilter == "" {
		return emulatorAppFilterUser, nil
	}
	switch appFilter {
	case emulatorAppFilterUser, emulatorAppFilterSystem, emulatorAppFilterAll:
		return appFilter, nil
	default:
		return "", apperr.New(
			errcode.CommonInvalidParam,
			"app_filter must be one of: user, system, all",
		)
	}
}

func isSandboxLeaseNotFound(err error) bool {
	if appError, ok := apperr.As(err); ok {
		return appError.Code() == errcode.SandboxLeaseNotFound
	}
	return false
}
