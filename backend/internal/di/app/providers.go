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

package app

import (
	"github.com/google/wire"

	"sico-backend/internal/biz/agent"
	"sico-backend/internal/biz/conversation"
	"sico-backend/internal/biz/knowledge"
	"sico-backend/internal/biz/llmhubs"
	"sico-backend/internal/biz/project"
	"sico-backend/internal/biz/rbac"
	"sico-backend/internal/biz/sandbox"
	"sico-backend/internal/biz/skill"
	"sico-backend/internal/biz/taskruntime"
)

var ProviderSet = wire.NewSet(
	project.ProviderSet,
	rbac.ProviderSet,
	knowledge.ProviderSet,
	agent.ProviderSet,
	conversation.ProviderSet,
	sandbox.ProviderSet,
	llmhubs.ProviderSet,
	skill.ProviderSet,
	taskruntime.ProviderSet,
)
