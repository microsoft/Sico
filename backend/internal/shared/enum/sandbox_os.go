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

// SandboxOS is the operating system a sandbox presents to a task.
//
// It is a *capability*, distinct from the provisioning SandboxType: a skill
// declares the OS it needs, and the scheduler matches that against whatever
// sandbox can supply it.
type SandboxOS string

const (
	SandboxOSAndroid SandboxOS = "android"
)

func (o SandboxOS) String() string { return string(o) }

// AllSandboxOSes returns the canonical OS selectors a task can request.
func AllSandboxOSes() []string {
	return []string{
		SandboxOSAndroid.String(),
	}
}

// typeOS maps a SandboxType to the single OS it always provides.
var typeOS = map[string]SandboxOS{
	SandboxTypeEmulator.String(): SandboxOSAndroid,
}

// MetadataOSKey is the resource-metadata key carrying a device's OS.
const MetadataOSKey = "os"

// ParseSandboxOS coerces a free-form OS string to a known SandboxOS.
//
// Unknown values return ("", false) so a caller can reject or ignore them
// rather than mis-routing a task.
func ParseSandboxOS(value string) (SandboxOS, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "android":
		return SandboxOSAndroid, true
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
	os, ok := typeOS[sandboxType]
	return os, ok
}

// EligibleTypesForOS returns the SandboxTypes that can supply the given OS.
func EligibleTypesForOS(os SandboxOS) []string {
	var result []string
	for _, t := range AllSandboxTypes() {
		if typeOS[t] == os {
			result = append(result, t)
		}
	}
	return result
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
