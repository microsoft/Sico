package enum

import "strings"

type SandboxType int

const (
	SandboxTypeUnknown SandboxType = iota
	SandboxTypeEmulator
	SandboxTypeLinuxWorkstation
	SandboxTypeWinCUA
	SandboxTypePhysical
)

func (s SandboxType) String() string {
	switch s {
	case SandboxTypeEmulator:
		return "emulator"
	case SandboxTypeLinuxWorkstation:
		return "linux_workstation"
	case SandboxTypeWinCUA:
		return "wincua"
	case SandboxTypePhysical:
		return "physical"
	case SandboxTypeUnknown:
		return "Unknown"
	default:
		return "Unknown"
	}
}

func AllSandboxTypes() []string {
	return []string{
		SandboxTypeEmulator.String(),
		SandboxTypeLinuxWorkstation.String(),
		SandboxTypeWinCUA.String(),
		SandboxTypePhysical.String(),
	}
}

func IsValidSandboxType(s string) bool {
	s = NormalizeSandboxType(s)
	switch s {
	case SandboxTypeEmulator.String(), SandboxTypeLinuxWorkstation.String(),
		SandboxTypeWinCUA.String(), SandboxTypePhysical.String():
		return true
	default:
		return false
	}
}

func NormalizeSandboxType(s string) string {
	return strings.TrimSpace(s)
}

// OpenAPIPath returns the OpenAPI endpoint path for each sandbox type
func (s SandboxType) OpenAPIPath() string {
	switch s {
	case SandboxTypeEmulator:
		return "/openapi.json"
	case SandboxTypeLinuxWorkstation:
		return "/v1/openapi.json"
	case SandboxTypeWinCUA:
		return "/openapi.json"
	case SandboxTypePhysical:
		return "/openapi.json"
	default:
		return ""
	}
}

// GetOpenAPIPath returns the OpenAPI endpoint path for a sandbox type string
func GetOpenAPIPath(sandboxType string) string {
	switch NormalizeSandboxType(sandboxType) {
	case SandboxTypeEmulator.String():
		return SandboxTypeEmulator.OpenAPIPath()
	case SandboxTypeLinuxWorkstation.String():
		return SandboxTypeLinuxWorkstation.OpenAPIPath()
	case SandboxTypeWinCUA.String():
		return SandboxTypeWinCUA.OpenAPIPath()
	case SandboxTypePhysical.String():
		return SandboxTypePhysical.OpenAPIPath()
	default:
		return ""
	}
}
