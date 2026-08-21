package enum

import "strings"

// SandboxOS is the operating system a sandbox presents to a task.
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

// ParseSandboxOS coerces a free-form OS string to a known SandboxOS.
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

// IsOSSelector reports whether selector names an OS capability (e.g. "android").
func IsOSSelector(selector string) bool {
	_, ok := ParseSandboxOS(selector)
	return ok
}
