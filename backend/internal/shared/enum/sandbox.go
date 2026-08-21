package enum

import "strings"

type SandboxType int

const (
	SandboxTypeUnknown SandboxType = iota
	SandboxTypeEmulator
	SandboxTypeAio
	SandboxTypeWinCUA
	SandboxTypePhysical
)

func (s SandboxType) String() string {
	switch s {
	case SandboxTypeEmulator:
		return "emulator"
	case SandboxTypeAio:
		return "aio"
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
		SandboxTypeAio.String(),
		SandboxTypeWinCUA.String(),
		SandboxTypePhysical.String(),
	}
}

func IsValidSandboxType(s string) bool {
	s = strings.TrimSpace(s)
	switch s {
	case SandboxTypeEmulator.String(), SandboxTypeAio.String(), SandboxTypeWinCUA.String(), SandboxTypePhysical.String():
		return true
	default:
		return false
	}
}

// OpenAPIPath returns the OpenAPI endpoint path for each sandbox type
func (s SandboxType) OpenAPIPath() string {
	switch s {
	case SandboxTypeEmulator:
		return "/openapi.json"
	case SandboxTypeAio:
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
	switch sandboxType {
	case SandboxTypeEmulator.String():
		return SandboxTypeEmulator.OpenAPIPath()
	case SandboxTypeAio.String():
		return SandboxTypeAio.OpenAPIPath()
	case SandboxTypeWinCUA.String():
		return SandboxTypeWinCUA.OpenAPIPath()
	case SandboxTypePhysical.String():
		return SandboxTypePhysical.OpenAPIPath()
	default:
		return ""
	}
}
