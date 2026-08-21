package enum

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestSandboxType_String(t *testing.T) {
	tests := []struct {
		typ  SandboxType
		want string
	}{
		{SandboxTypeEmulator, "emulator"},
		{SandboxTypeAio, "aio"},
		{SandboxTypeWinCUA, "wincua"},
		{SandboxTypePhysical, "physical"},
		{SandboxTypeUnknown, "Unknown"},
		{SandboxType(99), "Unknown"},
	}
	for _, tt := range tests {
		assert.Equal(t, tt.want, tt.typ.String())
	}
}

func TestAllSandboxTypes(t *testing.T) {
	types := AllSandboxTypes()
	assert.Contains(t, types, "emulator")
	assert.Contains(t, types, "aio")
	assert.Contains(t, types, "wincua")
	assert.Contains(t, types, "physical")
	assert.Len(t, types, 4)
}

func TestIsValidSandboxType(t *testing.T) {
	assert.True(t, IsValidSandboxType("emulator"))
	assert.True(t, IsValidSandboxType("  emulator  "))
	assert.True(t, IsValidSandboxType("aio"))
	assert.True(t, IsValidSandboxType("wincua"))
	assert.True(t, IsValidSandboxType("physical"))
	assert.False(t, IsValidSandboxType(""))
	assert.False(t, IsValidSandboxType("docker"))
}

func TestOpenAPIPath(t *testing.T) {
	assert.Equal(t, "/openapi.json", SandboxTypeEmulator.OpenAPIPath())
	assert.Equal(t, "/v1/openapi.json", SandboxTypeAio.OpenAPIPath())
	assert.Equal(t, "/openapi.json", SandboxTypeWinCUA.OpenAPIPath())
	assert.Equal(t, "/openapi.json", SandboxTypePhysical.OpenAPIPath())
	assert.Equal(t, "", SandboxTypeUnknown.OpenAPIPath())
}

func TestGetOpenAPIPath(t *testing.T) {
	assert.Equal(t, "/openapi.json", GetOpenAPIPath("emulator"))
	assert.Equal(t, "/v1/openapi.json", GetOpenAPIPath("aio"))
	assert.Equal(t, "/openapi.json", GetOpenAPIPath("wincua"))
	assert.Equal(t, "/openapi.json", GetOpenAPIPath("physical"))
	assert.Equal(t, "", GetOpenAPIPath("invalid"))
	assert.Equal(t, "", GetOpenAPIPath(""))
}
