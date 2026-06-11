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

import "testing"

func TestResolveResourceOS_FixedTypes(t *testing.T) {
	cases := map[string]SandboxOS{
		SandboxTypeEmulator.String(): SandboxOSAndroid,
	}
	for sandboxType, wantOS := range cases {
		os, ok := ResolveResourceOS(sandboxType, nil)
		if !ok || os != wantOS {
			t.Fatalf("ResolveResourceOS(%q) = (%q, %v), want (%q, true)", sandboxType, os, ok, wantOS)
		}
	}
}

func TestResolveResourceOS_UnknownTypeReturnsFalse(t *testing.T) {
	if _, ok := ResolveResourceOS("bogus", nil); ok {
		t.Fatal("unknown type should not resolve an OS")
	}
}

func TestEligibleTypesForOS(t *testing.T) {
	// Android: emulator (fixed).
	android := EligibleTypesForOS(SandboxOSAndroid)
	if !contains(android, SandboxTypeEmulator.String()) {
		t.Fatalf("android eligible = %v, want emulator", android)
	}
}

func TestParseSandboxOS_Aliases(t *testing.T) {
	if os, ok := ParseSandboxOS("android"); !ok || os != SandboxOSAndroid {
		t.Fatalf("ParseSandboxOS(\"android\") = (%q,%v), want android", os, ok)
	}
	if _, ok := ParseSandboxOS("emulator"); ok {
		t.Fatal("a concrete sandbox type must not parse as an OS")
	}
}

func TestIsOSSelector_DisjointFromTypes(t *testing.T) {
	for _, os := range []string{"android"} {
		if !IsOSSelector(os) {
			t.Fatalf("IsOSSelector(%q) = false, want true", os)
		}
	}
	for _, typ := range AllSandboxTypes() {
		if IsOSSelector(typ) {
			t.Fatalf("IsOSSelector(%q) = true, a concrete type must not be an OS selector", typ)
		}
	}
}

func contains(items []string, target string) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}
	return false
}

func containsAll(items []string, targets ...string) bool {
	for _, target := range targets {
		if !contains(items, target) {
			return false
		}
	}
	return true
}
