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

import "strings"

type SandboxType int

const (
	SandboxTypeUnknown SandboxType = iota
	SandboxTypeEmulator
)

func (s SandboxType) String() string {
	switch s {
	case SandboxTypeEmulator:
		return "emulator"
	case SandboxTypeUnknown:
		return "Unknown"
	default:
		return "Unknown"
	}
}

func AllSandboxTypes() []string {
	return []string{
		SandboxTypeEmulator.String(),
	}
}

func IsValidSandboxType(s string) bool {
	s = strings.TrimSpace(s)
	switch s {
	case SandboxTypeEmulator.String():
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
	default:
		return ""
	}
}

// GetOpenAPIPath returns the OpenAPI endpoint path for a sandbox type string
func GetOpenAPIPath(sandboxType string) string {
	switch sandboxType {
	case SandboxTypeEmulator.String():
		return SandboxTypeEmulator.OpenAPIPath()
	default:
		return ""
	}
}
