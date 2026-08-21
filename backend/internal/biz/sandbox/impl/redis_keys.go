package impl

import (
	"strconv"
	"strings"

	"sico-backend/internal/consts"
	"sico-backend/pkg/env"
)

const (
	sandboxRedisBasePrefix              = "sandbox:"
	sandboxRedisEnvPrefixSegment        = "env:"
	sandboxResourceKeySegment           = "resource:"
	sandboxSnapshotResourceKeySegment   = "snapshot:resource:"
	sandboxPendingShrinkKeySegment      = "snapshot:resource:pending-shrink:"
	sandboxSnapshotLeaderKeySegment     = "snapshot:resource:leader"
	sandboxCooldownKeySegment           = "cooldown:"
	sandboxAssignKeySegment             = "assign:"
	sandboxInstanceAssignLockKeySegment = "instance-lock:"
	sandboxOrgAssignKeySegment          = "org-assign:"
	sandboxProjectAssignKeySegment      = "project-assign:"
	sandboxOrgSandboxesKeySegment       = "org-sandboxes:"
	sandboxProjectSandboxesKeySegment   = "project-sandboxes:"
)

func sandboxRedisNamespace() string {
	if namespace := normalizeSandboxRedisNamespace(env.GetOrDefault(consts.SandboxRedisNamespace, "")); namespace != "" {
		return namespace
	}

	if env.IsDevelopment() {
		return "local"
	}

	return ""
}

func normalizeSandboxRedisNamespace(namespace string) string {
	namespace = strings.TrimSpace(strings.ToLower(namespace))
	if namespace == "" {
		return ""
	}

	var builder strings.Builder
	builder.Grow(len(namespace))
	lastWasDash := false
	for _, r := range namespace {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-', r == '_':
			builder.WriteRune(r)
			lastWasDash = false
		default:
			if builder.Len() == 0 || lastWasDash {
				continue
			}
			builder.WriteByte('-')
			lastWasDash = true
		}
	}

	return strings.Trim(builder.String(), "-")
}

func sandboxRedisPrefix() string {
	if namespace := sandboxRedisNamespace(); namespace != "" {
		return sandboxRedisBasePrefix + sandboxRedisEnvPrefixSegment + namespace + ":"
	}

	return sandboxRedisBasePrefix
}

func sandboxResourceKeyPrefix() string {
	return sandboxRedisPrefix() + sandboxResourceKeySegment
}

func resourceLeaseKey(sandboxID string) string {
	return sandboxResourceKeyPrefix() + sandboxID
}

func ResourceLeaseKeyForTest(sandboxID string) string {
	return resourceLeaseKey(sandboxID)
}

func resourceKey(t, id string) string {
	return resourceLeaseKey(t + ":" + id)
}

func resourceSnapshotKey(snapshotType string) string {
	return sandboxRedisPrefix() + sandboxSnapshotResourceKeySegment + snapshotType
}

func resourcePendingShrinkKey(snapshotType string) string {
	return sandboxRedisPrefix() + sandboxPendingShrinkKeySegment + snapshotType
}

func resourceSnapshotLeaderLockKey() string {
	return sandboxRedisPrefix() + sandboxSnapshotLeaderKeySegment
}

func cooldownKey(sandboxID string) string {
	return sandboxRedisPrefix() + sandboxCooldownKeySegment + sandboxID
}

func assignKey(instanceID string) string {
	return sandboxRedisPrefix() + sandboxAssignKeySegment + instanceID
}

func AssignKeyForTest(instanceID string) string {
	return assignKey(instanceID)
}

func instanceAssignLockKey(instanceID string) string {
	return sandboxRedisPrefix() + sandboxInstanceAssignLockKeySegment + instanceID
}

func orgAssignKey(sandboxID string) string {
	return sandboxRedisPrefix() + sandboxOrgAssignKeySegment + sandboxID
}

func projectAssignKey(sandboxID string) string {
	return sandboxRedisPrefix() + sandboxProjectAssignKeySegment + sandboxID
}

func orgSandboxesKey(orgID int64) string {
	return sandboxRedisPrefix() + sandboxOrgSandboxesKeySegment + strconv.FormatInt(orgID, 10)
}

func projectSandboxesKey(projectID int64) string {
	return sandboxRedisPrefix() + sandboxProjectSandboxesKeySegment + strconv.FormatInt(projectID, 10)
}
