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

package agent

import (
	"context"

	entity "sico-backend/internal/entity/agent/singleagent"
	"sico-backend/internal/transport/http/dto/agent/single_agent"
)

type Service interface {
	GetSingleAgent(ctx context.Context, req *single_agent.GetSingleAgentRequest) (*single_agent.GetSingleAgentResponse, error)
	GetSingleAgentInstance(ctx context.Context, id int64) (*entity.SingleAgentInstance, error)
	GetSingleAgentInstanceNames(ctx context.Context, ids []int64) (map[int64]string, error)
	GetSingleAgentInstanceIconURIs(ctx context.Context, ids []int64) (map[int64]string, error)
	ListSingleAgentInstancesByFilter(
		ctx context.Context, filter *entity.ListSingleAgentInstanceFilter,
		offset, limit int,
	) ([]*entity.SingleAgentInstance, int64, error)
	DismissSingleAgentInstance(
		ctx context.Context, req *single_agent.DismissSingleAgentInstanceRequest,
	) (*single_agent.DismissSingleAgentInstanceResponse, error)
	ReassignSingleAgentInstance(
		ctx context.Context, req *single_agent.ReassignSingleAgentInstanceRequest,
	) (*single_agent.ReassignSingleAgentInstanceResponse, error)
	UpdateSingleAgentInstanceStatus(
		ctx context.Context, req *single_agent.UpdateSingleAgentInstanceStatusRequest,
	) (*single_agent.UpdateSingleAgentInstanceStatusResponse, error)
}

var defaultSvc Service

func Default() Service { return defaultSvc }

func SetDefault(svc Service) { defaultSvc = svc }
