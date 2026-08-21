package enum

import "strings"

// SandboxOS is the operating system a sandbox presents to a task.
//
// It is a *capability*, distinct from the provisioning SandboxType: a skill
// declares the OS it needs, and the scheduler matches that against whatever
// sandbox can supply it.
type SandboxOS string

const (
	SandboxOSWindows SandboxOS = "windows"
	SandboxOSMacOS   SandboxOS = "macos"
	SandboxOSIOS     SandboxOS = "ios"
	SandboxOSAndroid SandboxOS = "android"
	SandboxOSLinux   SandboxOS = "linux"
)

func (o SandboxOS) String() string { return string(o) }

// AllSandboxOSes returns the canonical OS selectors a task can request.
func AllSandboxOSes() []string {
	return []string{
		SandboxOSWindows.String(),
		SandboxOSMacOS.String(),
		SandboxOSIOS.String(),
		SandboxOSAndroid.String(),
		SandboxOSLinux.String(),
	}
}

// typeOS maps a SandboxType to the single OS it always provides.
var typeOS = map[string]SandboxOS{
	SandboxTypeEmulator.String(): SandboxOSAndroid,
	SandboxTypeWinCUA.String():   SandboxOSWindows,
	SandboxTypeAio.String():      SandboxOSLinux,
}

// MetadataOSKey is the resource-metadata key carrying a device's OS.
const MetadataOSKey = "os"

// ParseSandboxOS coerces a free-form OS string to a known SandboxOS.
//
// Unknown values return ("", false) so a caller can reject or ignore them
// rather than mis-routing a task.
func ParseSandboxOS(value string) (SandboxOS, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "windows", "win", "win32", "win64":
		return SandboxOSWindows, true
	case "macos", "mac", "osx", "darwin":
		return SandboxOSMacOS, true
	case "ios", "iphoneos", "ipados":
		return SandboxOSIOS, true
	case "android":
		return SandboxOSAndroid, true
	case "linux":
		return SandboxOSLinux, true
	default:
		return "", false
	}
}

// ResolveResourceOS returns the OS a single sandbox resource provides.
//
// Returns ("", false) when the OS cannot be determined (an unknown type),
// so the resource is simply not matched rather than matched incorrectly.
func ResolveResourceOS(sandboxType string, metadata map[string]string) (SandboxOS, bool) {
	sandboxType = strings.TrimSpace(sandboxType)
	if sandboxType == SandboxTypePhysical.String() {
		if metadata == nil {
			return "", false
		}
		return ParseSandboxOS(metadata[MetadataOSKey])
	}

	os, ok := typeOS[sandboxType]
	return os, ok
}

// EligibleTypesForOS returns the SandboxTypes that can supply the given OS.
func EligibleTypesForOS(os SandboxOS) []string {
	var fixed []string
	physicalEligible := false
	for _, t := range AllSandboxTypes() {
		if t == SandboxTypePhysical.String() {
			physicalEligible = true
			continue
		}
		if typeOS[t] == os {
			fixed = append(fixed, t)
		}
	}

	if physicalEligible {
		return append(fixed, SandboxTypePhysical.String())
	}
	return fixed
}

// IsOSSelector reports whether selector names an OS capability (e.g. "android").
//
// Scheduling (apply / acquire / instance listing) accepts OS selectors only. OS
// names and concrete SandboxType names do not overlap, so callers use this to
// reject a concrete type passed where an OS is expected.
func IsOSSelector(selector string) bool {
	_, ok := ParseSandboxOS(selector)
	return ok
}
