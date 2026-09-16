package seeds

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"sico-backend/internal/biz/sandbox"
	"sico-backend/internal/shared/enum"
	"sico-backend/pkg/logger"
)

type linuxWorkstationAssignmentService interface {
	sandboxScopeAssignmentService
	GetInstanceSandboxesWithStatus(ctx context.Context, instanceID, selector string) ([]map[string]interface{}, error)
	AssignSandbox(ctx context.Context, instanceID, sandboxID string) error
}

type sandboxResourceLister interface {
	ListAllResources(ctx context.Context) (map[string]interface{}, error)
}

type sandboxScopeAssignmentService interface {
	sandboxResourceLister
	GetSandboxOrgID(ctx context.Context, sandboxID string) (int64, error)
	GetSandboxProjectID(ctx context.Context, sandboxID string) (int64, error)
	AssignSandboxToOrg(ctx context.Context, orgID int64, sandboxIDs []string) error
	AssignSandboxToProject(ctx context.Context, projectID, orgID int64, sandboxIDs []string) error
}

var (
	linuxWorkstationPollMaxAttempts   = 5
	linuxWorkstationPollRetryInterval = 2 * time.Second
)

func checkLinuxWorkstationAssigned(ctx context.Context, agentInstanceID int64) error {
	svc := sandbox.Default()
	if svc == nil {
		logger.CtxInfo(ctx, "checkLinuxWorkstationAssigned: sandbox service not initialized; skipping")
		return nil
	}
	return reconcileLinuxWorkstationAssignment(ctx, svc, strconv.FormatInt(agentInstanceID, 10))
}

func ensureDefaultSandboxScopes(ctx context.Context) {
	svc := sandbox.Default()
	if svc == nil {
		logger.CtxInfo(ctx, "ensureDefaultSandboxScopes: sandbox service not initialized; skipping")
		return
	}
	ensureAvailableSandboxScopes(ctx, svc)
}

func ensureAvailableSandboxScopes(ctx context.Context, svc sandboxScopeAssignmentService) {
	sandboxTypes := []string{
		enum.SandboxTypeLinuxWorkstation.String(),
		enum.SandboxTypeEmulator.String(),
	}
	for _, sandboxType := range sandboxTypes {
		sandboxID, err := pollAllocatableSandbox(ctx, svc, sandboxType)
		if err != nil {
			logger.CtxWarn(
				ctx, "ensureDefaultSandboxScopes: find %s sandbox failed (non-fatal): %v", sandboxType, err,
			)
			continue
		}
		if sandboxID == "" {
			continue
		}
		if err := ensureSandboxScopes(ctx, svc, sandboxID); err != nil {
			logger.CtxWarn(ctx,
				"ensureDefaultSandboxScopes: scope sandbox=%s type=%s failed (non-fatal): %v",
				sandboxID, sandboxType, err)
		}
	}
}

func reconcileLinuxWorkstationAssignment(ctx context.Context, svc linuxWorkstationAssignmentService, instanceID string) error {
	assigned, err := svc.GetInstanceSandboxesWithStatus(ctx, instanceID, enum.SandboxTypeLinuxWorkstation.String())
	if err == nil {
		if sandboxID := usableLinuxWorkstationAssignmentID(assigned); sandboxID != "" {
			return ensureSandboxScopes(ctx, svc, sandboxID)
		}
	}

	pickedID, err := pollAllocatableSandbox(ctx, svc, enum.SandboxTypeLinuxWorkstation.String())
	if err != nil || pickedID == "" {
		return err
	}
	if err := ensureSandboxScopes(ctx, svc, pickedID); err != nil {
		return err
	}
	if err := svc.AssignSandbox(ctx, instanceID, pickedID); err != nil {
		return err
	}
	logger.CtxInfo(ctx, "checkLinuxWorkstationAssigned: bound sandbox %s "+
		"to Linux Workstation Pilot instance %s", pickedID, instanceID)
	return nil
}

func usableLinuxWorkstationAssignmentID(assigned []map[string]interface{}) string {
	for _, item := range assigned {
		status, _ := item["status"].(string)
		if status == "assigned" || status == "in_use" {
			sandboxID, _ := item["sandbox_id"].(string)
			return sandboxID
		}
	}
	return ""
}

func ensureSandboxScopes(ctx context.Context, svc sandboxScopeAssignmentService, sandboxID string) error {
	orgID, err := svc.GetSandboxOrgID(ctx, sandboxID)
	if err != nil {
		return err
	}
	if orgID != 0 && orgID != defaultOrganizationId {
		return fmt.Errorf("sandbox %s belongs to organization %d", sandboxID, orgID)
	}
	if orgID == 0 {
		if err := svc.AssignSandboxToOrg(ctx, defaultOrganizationId, []string{sandboxID}); err != nil {
			return err
		}
	}
	projectID, err := svc.GetSandboxProjectID(ctx, sandboxID)
	if err != nil {
		return err
	}
	if projectID != 0 && projectID != defaultProjectId {
		return fmt.Errorf("sandbox %s belongs to project %d", sandboxID, projectID)
	}
	if projectID == 0 {
		return svc.AssignSandboxToProject(ctx, defaultProjectId, defaultOrganizationId, []string{sandboxID})
	}
	return nil
}

func pollAllocatableSandbox(ctx context.Context, svc sandboxResourceLister, sandboxType string) (string, error) {
	for attempt := 1; attempt <= linuxWorkstationPollMaxAttempts; attempt++ {
		resourcesByType, err := svc.ListAllResources(ctx)
		if err == nil {
			resources, _ := resourcesByType[sandboxType].([]map[string]interface{})
			for _, resource := range resources {
				allocatable, _ := resource["allocatable"].(bool)
				sandboxID, _ := resource["sandbox_id"].(string)
				if allocatable && sandboxID != "" {
					return sandboxID, nil
				}
			}
		}
		if attempt < linuxWorkstationPollMaxAttempts {
			select {
			case <-ctx.Done():
				return "", ctx.Err()
			case <-time.After(linuxWorkstationPollRetryInterval):
			}
		}
	}
	logger.CtxInfo(ctx, "no allocatable %s sandbox found during seed reconciliation", sandboxType)
	return "", nil
}

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
func pollAllocatableEmulator(ctx context.Context, svc sandboxResourceLister) (string, error) {
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
func pickAllocatableEmulator(
	ctx context.Context,
	svc sandboxResourceLister,
	emulatorType string,
	attempt, maxAttempts int,
) string {
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
