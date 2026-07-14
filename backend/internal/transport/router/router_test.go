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

package router

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"

	"sico-backend/internal/transport/http/middleware"
)

func TestSandboxRoutesAreNotPublicByDefault(t *testing.T) {
	gin.SetMode(gin.TestMode)

	engine := gin.New()
	RegisterAPIs(engine)

	publicSandboxRoutes := map[string]bool{
		http.MethodPost + " /api/sico/sandbox/apply":   true,
		http.MethodPost + " /api/sico/sandbox/release": true,
	}
	discoveredSandboxRoutes := map[string]struct{}{}

	for _, route := range engine.Routes() {
		if !strings.HasPrefix(route.Path, "/api/sico/sandbox") {
			continue
		}

		path := concreteSandboxRoute(route.Path)
		key := route.Method + " " + path
		discoveredSandboxRoutes[key] = struct{}{}

		assert.Equalf(
			t,
			publicSandboxRoutes[key],
			isSandboxRouteAuthExcluded(route.Method, path),
			"unexpected auth-exclusion for sandbox route %s",
			key,
		)
	}

	for expectedRoute := range publicSandboxRoutes {
		assert.Containsf(
			t,
			discoveredSandboxRoutes,
			expectedRoute,
			"expected whitelisted sandbox route %s to stay registered",
			expectedRoute,
		)
	}
}

func concreteSandboxRoute(path string) string {
	parts := strings.Split(path, "/")
	for i, part := range parts {
		if strings.HasPrefix(part, ":") || strings.HasPrefix(part, "*") {
			parts[i] = "sample"
		}
	}
	return strings.Join(parts, "/")
}

func isSandboxRouteAuthExcluded(method, path string) bool {
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)
	ctx.Request = httptest.NewRequest(method, path, nil)
	return middleware.IsAuthExcluded(ctx)
}
