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

package llmhubs

import (
	"context"
	"strings"

	dto "sico-backend/internal/transport/http/dto/llmhubs"
)

// ListAgentCustomModelEntries paginates through custom (non-builtin) active models
// scoped to the given agent and returns them as DTO entries.
func ListAgentCustomModelEntries(ctx context.Context, agentID string) ([]*dto.ModelRegistryEntry, error) {
	if strings.TrimSpace(agentID) == "" {
		return nil, nil
	}

	const pageSize = 100
	items := make([]*dto.ModelRegistryEntry, 0)

	for page := int32(1); ; page++ {
		resp, err := Default().ListModels(ctx, &dto.ListModelRegistryRequest{
			AgentId:  agentID,
			Status:   1,
			Page:     page,
			PageSize: pageSize,
		})
		if err != nil {
			return nil, err
		}
		if resp == nil || resp.Data == nil || len(resp.Data.Items) == 0 {
			break
		}

		for _, item := range resp.Data.Items {
			if item == nil || item.IsBuiltin {
				continue
			}
			items = append(items, item)
		}

		if int32(len(resp.Data.Items)) < pageSize {
			break
		}
	}

	return items, nil
}
