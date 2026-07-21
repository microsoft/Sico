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

package handler

import (
	"context"

	sandboxbiz "sico-backend/internal/biz/sandbox"
	commondto "sico-backend/internal/transport/http/dto/common"
)

func getInstanceSandboxes(ctx context.Context, instanceID string) []*commondto.SandboxDigest {
	svc := sandboxbiz.Default()
	if svc == nil {
		return nil
	}

	sandboxes, err := svc.GetInstanceSandboxesWithStatus(ctx, instanceID, "")
	if err != nil || len(sandboxes) == 0 {
		return nil
	}

	var result []*commondto.SandboxDigest
	for _, sb := range sandboxes {
		info := &commondto.SandboxDigest{
			SandboxId:   getStringFromMap(sb, "sandbox_id"),
			Type:        getStringFromMap(sb, "type"),
			Status:      getStringFromMap(sb, "status"),
			Endpoint:    getStringFromMap(sb, "endpoint"),
			VncUrl:      getStringFromMap(sb, "vnc_url"),
			DocsUrl:     getStringFromMap(sb, "docs_url"),
			DisplayName: getStringFromMap(sb, "display_name"),
		}
		result = append(result, info)
	}
	return result
}

func getStringFromMap(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}
