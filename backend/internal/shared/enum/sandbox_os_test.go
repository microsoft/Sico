package enum

import "testing"

func TestResolveResourceOS_FixedTypes(t *testing.T) {
	cases := map[string]SandboxOS{
		SandboxTypeEmulator.String(): SandboxOSAndroid,
		SandboxTypeAio.String():      SandboxOSLinux,
		SandboxTypeWinCUA.String():   SandboxOSWindows,
	}
	for sandboxType, wantOS := range cases {
		os, ok := ResolveResourceOS(sandboxType, nil)
		if !ok || os != wantOS {
			t.Fatalf("ResolveResourceOS(%q) = (%q, %v), want (%q, true)", sandboxType, os, ok, wantOS)
		}
	}
}

func TestResolveResourceOS_PhysicalUsesMetadata(t *testing.T) {
	os, ok := ResolveResourceOS(SandboxTypePhysical.String(), map[string]string{MetadataOSKey: "darwin"})
	if !ok || os != SandboxOSMacOS {
		t.Fatalf("physical OS = (%q, %v), want (%q, true)", os, ok, SandboxOSMacOS)
	}
	if _, ok := ResolveResourceOS(SandboxTypePhysical.String(), nil); ok {
		t.Fatal("physical resource without OS metadata should not resolve")
	}
}

func TestResolveResourceOS_UnknownTypeReturnsFalse(t *testing.T) {
	if _, ok := ResolveResourceOS("bogus", nil); ok {
		t.Fatal("unknown type should not resolve an OS")
	}
}

func TestEligibleTypesForOS(t *testing.T) {
	tests := map[SandboxOS][]string{
		SandboxOSAndroid: {SandboxTypeEmulator.String(), SandboxTypePhysical.String()},
		SandboxOSLinux:   {SandboxTypeAio.String(), SandboxTypePhysical.String()},
		SandboxOSWindows: {SandboxTypeWinCUA.String(), SandboxTypePhysical.String()},
		SandboxOSMacOS:   {SandboxTypePhysical.String()},
		SandboxOSIOS:     {SandboxTypePhysical.String()},
	}
	for os, want := range tests {
		got := EligibleTypesForOS(os)
		if !equalStrings(got, want) {
			t.Fatalf("EligibleTypesForOS(%q) = %v, want %v", os, got, want)
		}
	}
}

func TestParseSandboxOS_Aliases(t *testing.T) {
	tests := map[string]SandboxOS{
		"win32":    SandboxOSWindows,
		"darwin":   SandboxOSMacOS,
		"iphoneos": SandboxOSIOS,
		"android":  SandboxOSAndroid,
		"linux":    SandboxOSLinux,
	}
	for value, want := range tests {
		if os, ok := ParseSandboxOS(value); !ok || os != want {
			t.Fatalf("ParseSandboxOS(%q) = (%q,%v), want %q", value, os, ok, want)
		}
	}
	if _, ok := ParseSandboxOS("emulator"); ok {
		t.Fatal("a concrete sandbox type must not parse as an OS")
	}
}

func TestIsOSSelector_DisjointFromTypes(t *testing.T) {
	for _, os := range AllSandboxOSes() {
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

func equalStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
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
