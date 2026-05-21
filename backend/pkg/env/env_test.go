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

package env

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGetOrDefault(t *testing.T) {
	const key = "SICO_ENV_TEST_GET_OR_DEFAULT"
	if err := os.Unsetenv(key); err != nil {
		t.Fatalf("Unsetenv(%q) failed: %v", key, err)
	}

	if got := GetOrDefault(key, "fallback"); got != "fallback" {
		t.Fatalf("unset: got %q, want %q", got, "fallback")
	}

	t.Setenv(key, "value")
	if got := GetOrDefault(key, "fallback"); got != "value" {
		t.Fatalf("set: got %q, want %q", got, "value")
	}

	t.Setenv(key, "")
	if got := GetOrDefault(key, "fallback"); got != "" {
		t.Fatalf("empty string is still set: got %q, want %q", got, "")
	}
}

func TestMustGet(t *testing.T) {
	const key = "SICO_ENV_TEST_MUST_GET"
	if err := os.Unsetenv(key); err != nil {
		t.Fatalf("Unsetenv(%q) failed: %v", key, err)
	}

	defer func() {
		if r := recover(); r == nil {
			t.Fatal("MustGet should panic when unset")
		}
	}()
	_ = MustGet(key)
}

func TestMustGet_Set(t *testing.T) {
	const key = "SICO_ENV_TEST_MUST_GET_SET"
	t.Setenv(key, "v")
	if got := MustGet(key); got != "v" {
		t.Fatalf("got %q, want %q", got, "v")
	}
}

func TestGetBoolOrDefault(t *testing.T) {
	const key = "SICO_ENV_TEST_BOOL"

	cases := []struct {
		name    string
		value   string
		set     bool
		fallback bool
		want    bool
	}{
		{"unset-true-default", "", false, true, true},
		{"unset-false-default", "", false, false, false},
		{"true", "true", true, false, true},
		{"TRUE", "TRUE", true, false, true},
		{"one", "1", true, false, true},
		{"yes", "yes", true, false, true},
		{"false", "false", true, true, false},
		{"zero", "0", true, true, false},
		{"no", "no", true, true, false},
		{"invalid-falls-back", "maybe", true, true, true},
		{"whitespace-true", "  true  ", true, false, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.set {
				t.Setenv(key, tc.value)
			} else {
				if err := os.Unsetenv(key); err != nil {
					t.Fatalf("Unsetenv(%q) failed: %v", key, err)
				}
			}
			if got := GetBoolOrDefault(key, tc.fallback); got != tc.want {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		})
	}
}

func TestAppEnv(t *testing.T) {
	cases := []struct {
		value string
		set   bool
		want  string
	}{
		{"", false, AppEnvProduction},
		{"", true, AppEnvProduction},
		{"production", true, AppEnvProduction},
		{"PROD", true, AppEnvProduction},
		{"release", true, AppEnvProduction},
		{"development", true, AppEnvDevelopment},
		{"dev", true, AppEnvDevelopment},
		{"debug", true, AppEnvDevelopment},
		{"test", true, AppEnvTest},
		{"testing", true, AppEnvTest},
		{"nonsense", true, AppEnvProduction},
	}
	for _, tc := range cases {
		name := tc.value
		if !tc.set {
			name = "unset"
		}
		t.Run(name, func(t *testing.T) {
			if tc.set {
				t.Setenv(AppEnvKey, tc.value)
			} else {
				if err := os.Unsetenv(AppEnvKey); err != nil {
					t.Fatalf("Unsetenv(%q) failed: %v", AppEnvKey, err)
				}
			}
			if got := AppEnv(); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestIsProductionAndDevelopment(t *testing.T) {
	t.Setenv(AppEnvKey, "development")
	if !IsDevelopment() || IsProduction() {
		t.Fatalf("development: IsDevelopment=%v IsProduction=%v", IsDevelopment(), IsProduction())
	}

	t.Setenv(AppEnvKey, "production")
	if !IsProduction() || IsDevelopment() {
		t.Fatalf("production: IsDevelopment=%v IsProduction=%v", IsDevelopment(), IsProduction())
	}
}

func TestFindBackendRootPath_Default(t *testing.T) {
	if err := os.Unsetenv(BackendRootKey); err != nil {
		t.Fatalf("Unsetenv(%q) failed: %v", BackendRootKey, err)
	}
	root := FindBackendRootPath()
	if !filepath.IsAbs(root) {
		t.Fatalf("expected absolute path, got %q", root)
	}
	if !strings.HasSuffix(filepath.ToSlash(root), "/backend") {
		t.Fatalf("expected path ending in /backend, got %q", root)
	}
}

func TestFindBackendRootPath_Override(t *testing.T) {
	t.Setenv(BackendRootKey, "/custom/root")
	if got := FindBackendRootPath(); got != "/custom/root" {
		t.Fatalf("got %q, want %q", got, "/custom/root")
	}
}

func TestLoadDotEnv_MissingFileIsOK(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "does-not-exist.env")
	if err := LoadDotEnv(path); err != nil {
		t.Fatalf("unexpected error for missing file: %v", err)
	}
}

func TestLoadDotEnv_LoadsValues(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".env")
	if err := os.WriteFile(path, []byte("SICO_ENV_TEST_LOADED=hello\n"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := os.Unsetenv("SICO_ENV_TEST_LOADED"); err != nil {
		t.Fatalf("Unsetenv(%q) failed: %v", "SICO_ENV_TEST_LOADED", err)
	}
	if err := LoadDotEnv(path); err != nil {
		t.Fatalf("load: %v", err)
	}
	if got := os.Getenv("SICO_ENV_TEST_LOADED"); got != "hello" {
		t.Fatalf("got %q, want %q", got, "hello")
	}
}
