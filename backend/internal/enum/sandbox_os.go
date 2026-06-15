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

// ParseSandboxOS coerces a free-form OS string to a known SandboxOS.
func ParseSandboxOS(value string) (SandboxOS, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "android":
		return SandboxOSAndroid, true
	default:
		return "", false
	}
}

// IsOSSelector reports whether selector names an OS capability (e.g. "android").
func IsOSSelector(selector string) bool {
	_, ok := ParseSandboxOS(selector)
	return ok
}
