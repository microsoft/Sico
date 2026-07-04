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

package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestIsAuthExcluded_OnlyAllowsExpectedSandboxEndpoints(t *testing.T) {
	t.Run("sandbox endpoints", func(t *testing.T) {
		tests := []struct {
			name   string
			method string
			path   string
			want   bool
		}{
			{
				name:   "sandbox apply POST is explicitly public",
				method: http.MethodPost,
				path:   "/api/sico/sandbox/apply",
				want:   true,
			},
			{
				name:   "sandbox release POST is explicitly public",
				method: http.MethodPost,
				path:   "/api/sico/sandbox/release",
				want:   true,
			},
			{
				name:   "sandbox list GET is protected",
				method: http.MethodGet,
				path:   "/api/sico/sandbox/list",
				want:   false,
			},
			{
				name:   "sandbox reset POST is protected",
				method: http.MethodPost,
				path:   "/api/sico/sandbox/reset",
				want:   false,
			},
			{
				name:   "sandbox instance vnc GET is protected",
				method: http.MethodGet,
				path:   "/api/sico/sandbox/instance/abc/vnc",
				want:   false,
			},
			{
				name:   "sandbox emulator api ANY path is protected",
				method: http.MethodGet,
				path:   "/api/sico/sandbox/resources/emulator/abc/api/status",
				want:   false,
			},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
				ctx.Request = httptest.NewRequest(tt.method, tt.path, nil)
				assert.Equal(t, tt.want, IsAuthExcluded(ctx))
			})
		}
	})
}
