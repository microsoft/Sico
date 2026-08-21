package seeds

import (
	"context"
	"strconv"
	"time"

	"sico-backend/internal/biz/sandbox"
	"sico-backend/internal/shared/enum"
	"sico-backend/pkg/logger"
)

// checkSandboxAssigned unbinds any existing sandbox bindings from the
// default agent instance and then assigns the first allocatable emulator
// sandbox. The assignment order is org → project → instance so that
// org/project-scoped queries work correctly. All errors are logged and
// swallowed by the caller — this is best-effort.
func checkSandboxAssigned(ctx context.Context, agentInstanceID int64) error {
	svc := sandbox.Default()
	if svc == nil {
		logger.CtxInfo(ctx, "checkDefaultSandboxAssignment: sandbox service not initialized; skipping")
		return nil
	}

	instanceID := strconv.FormatInt(agentInstanceID, 10)

	// Always clean up existing bindings so we get a fresh assignment.
	if err := svc.CleanupInstanceSandboxes(ctx, instanceID); err != nil {
		logger.CtxWarn(ctx, "checkDefaultSandboxAssignment: cleanup existing bindings failed: %v", err)
	}

	pickedID, err := pollAllocatableEmulator(ctx, svc)
	if err != nil {
		return err
	}
	if pickedID == "" {
		logger.CtxInfo(ctx,
			"checkDefaultSandboxAssignment: no allocatable emulator sandbox found; "+
				"default agent instance %s left unbound",
			instanceID)
		return nil
	}

	// Assign sandbox scope: org → project → instance.
	if err := svc.AssignSandboxToOrg(ctx, defaultOrganizationId, []string{pickedID}); err != nil {
		logger.CtxWarn(ctx,
			"checkDefaultSandboxAssignment: org assign sandbox=%s org=%d failed (non-fatal): %v",
			pickedID, defaultOrganizationId, err)
	} else {
		if err := svc.AssignSandboxToProject(
			ctx, defaultProjectId, defaultOrganizationId, []string{pickedID},
		); err != nil {
			logger.CtxWarn(ctx,
				"checkDefaultSandboxAssignment: project assign sandbox=%s project=%d failed (non-fatal): %v",
				pickedID, defaultProjectId, err)
		}
	}

	if err := svc.AssignSandbox(ctx, instanceID, pickedID); err != nil {
		return err
	}

	logger.CtxInfo(ctx,
		"checkDefaultSandboxAssignment: bound sandbox %s to default agent instance %s",
		pickedID, instanceID)
	return nil
}

// pollAllocatableEmulator polls the sandbox pool for a short window waiting
// for the background snapshot refresh to report at least one allocatable
// emulator. Returns the picked sandbox ID (or "" if none became available)
// and propagates ctx.Err() when the context is cancelled between retries.
func pollAllocatableEmulator(ctx context.Context, svc sandbox.Service) (string, error) {
	const (
		maxAttempts   = 5
		retryInterval = 2 * time.Second
	)
	emulatorType := enum.SandboxTypeEmulator.String()

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if picked := pickAllocatableEmulator(ctx, svc, emulatorType, attempt, maxAttempts); picked != "" {
			return picked, nil
		}
		if attempt == maxAttempts {
			break
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(retryInterval):
		}
	}
	return "", nil
}

// pickAllocatableEmulator performs a single ListAllResources scan and returns
// the first allocatable emulator's sandbox_id, or "" if none is found.
func pickAllocatableEmulator(ctx context.Context, svc sandbox.Service, emulatorType string, attempt, maxAttempts int) string {
	resourcesByType, listErr := svc.ListAllResources(ctx)
	if listErr != nil {
		logger.CtxInfo(ctx,
			"checkDefaultSandboxAssignment: ListAllResources attempt %d/%d not ready: %v",
			attempt, maxAttempts, listErr)
		return ""
	}
	emulators, _ := resourcesByType[emulatorType].([]map[string]interface{})
	for _, r := range emulators {
		alloc, _ := r["allocatable"].(bool)
		if !alloc {
			continue
		}
		if sid, _ := r["sandbox_id"].(string); sid != "" {
			return sid
		}
	}
	logger.CtxInfo(ctx,
		"checkDefaultSandboxAssignment: no allocatable emulator yet (attempt %d/%d)",
		attempt, maxAttempts)
	return ""
}
