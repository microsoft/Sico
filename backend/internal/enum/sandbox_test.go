// Copyright (c) 2026 Sico Authors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

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
	assert.Len(t, types, 1)
}

func TestIsValidSandboxType(t *testing.T) {
	assert.True(t, IsValidSandboxType("emulator"))
	assert.True(t, IsValidSandboxType("  emulator  "))
	assert.False(t, IsValidSandboxType("aio"))
	assert.False(t, IsValidSandboxType(""))
	assert.False(t, IsValidSandboxType("docker"))
}

func TestOpenAPIPath(t *testing.T) {
	assert.Equal(t, "/openapi.json", SandboxTypeEmulator.OpenAPIPath())
	assert.Equal(t, "", SandboxTypeUnknown.OpenAPIPath())
}

func TestGetOpenAPIPath(t *testing.T) {
	assert.Equal(t, "/openapi.json", GetOpenAPIPath("emulator"))
	assert.Equal(t, "", GetOpenAPIPath("aio"))
	assert.Equal(t, "", GetOpenAPIPath("invalid"))
	assert.Equal(t, "", GetOpenAPIPath(""))
}
