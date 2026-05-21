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

// Package env provides lightweight helpers for reading environment variables
// and locating the backend source root. It intentionally has no side-effects
// on import; callers that want to populate process environment from a .env
// file should call LoadDotEnv explicitly (typically from main).
package env

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/joho/godotenv"
)

// Get returns the value of the environment variable named by key and whether
// it was set.
func Get(key string) (string, bool) {
	return os.LookupEnv(key)
}

// GetOrDefault returns the value of the environment variable named by key,
// or defaultValue if the variable is unset.
func GetOrDefault(key, defaultValue string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return defaultValue
}

// MustGet returns the value of the environment variable named by key and
// panics if it is unset. Prefer Get/GetOrDefault outside of process startup.
func MustGet(key string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	panic("env: required environment variable not set: " + key)
}

// GetBoolOrDefault parses the environment variable named by key as a boolean.
// Accepts "true", "1", "yes" (case-insensitive) as true. Any other value, or
// an unset variable, returns defaultValue.
func GetBoolOrDefault(key string, defaultValue bool) bool {
	v, ok := os.LookupEnv(key)
	if !ok {
		return defaultValue
	}
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "true", "1", "yes":
		return true
	case "false", "0", "no":
		return false
	default:
		return defaultValue
	}
}

// Application environment keys and values.
const (
	// AppEnvKey is the environment variable used to signal the deployment
	// environment ("development", "test", "production"). Defaults to
	// production when unset so that open-source deployments are safe by
	// default.
	AppEnvKey = "APP_ENV"

	AppEnvDevelopment = "development"
	AppEnvTest        = "test"
	AppEnvProduction  = "production"
)

// AppEnv returns the normalized application environment. Accepts common
// aliases ("dev"→development, "prod"/"release"→production). Defaults to
// production when APP_ENV is unset or unrecognised.
func AppEnv() string {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(AppEnvKey))) {
	case "dev", "development", "debug":
		return AppEnvDevelopment
	case "test", "testing":
		return AppEnvTest
	case "", "prod", "production", "release":
		return AppEnvProduction
	default:
		return AppEnvProduction
	}
}

// IsProduction reports whether the current APP_ENV indicates production.
func IsProduction() bool { return AppEnv() == AppEnvProduction }

// IsDevelopment reports whether the current APP_ENV indicates development.
func IsDevelopment() bool { return AppEnv() == AppEnvDevelopment }

// LoadDotEnv loads variables from a .env file into the process environment.
// Missing files are not treated as an error so this is safe to call during
// application startup. Pass an empty path to use <backend-root>/.env.
func LoadDotEnv(path string) error {
	if path == "" {
		path = filepath.Join(FindBackendRootPath(), ".env")
	}
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return nil
	}
	return godotenv.Load(path)
}

// BackendRootKey overrides the detected backend root path. Useful in
// container or binary deployments where the build-time source tree does not
// exist at runtime.
const BackendRootKey = "BACKEND_ROOT"

// FindBackendRootPath returns the absolute path to the backend module root.
// When the BACKEND_ROOT environment variable is set it is returned verbatim;
// otherwise the path is inferred from this file's compile-time location,
// which assumes the source tree is available at runtime (e.g. development).
func FindBackendRootPath() string {
	if v := strings.TrimSpace(os.Getenv(BackendRootKey)); v != "" {
		return v
	}
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		panic("env: failed to determine backend root path")
	}
	// <root>/pkg/env/env.go -> <root>
	return filepath.Dir(filepath.Dir(filepath.Dir(filename)))
}
