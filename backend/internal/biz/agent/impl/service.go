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

package impl

import (
	"sico-backend/internal/infra/storage"
	"sico-backend/internal/store/agent/singleagent/repository"
	projectrepo "sico-backend/internal/store/project/repository"

	"gorm.io/gorm"
)

// Components aggregates infrastructure dependencies required by the agent service implementation.
type Components struct {
	SingleAgentRepo             repository.SingleAgentRepository
	SingleAgentLLMHubConfigRepo repository.SingleAgentLLMHubConfigRepository
	SingleAgentInstanceRepo     repository.SingleAgentInstanceRepository
	ProjectRepo                 projectrepo.ProjectRepository
	Storage                     storage.Storage
}

// Service orchestrates agent-related business workflows across repositories and external integrations.
type Service struct {
	*Components
	DB *gorm.DB
}

// NewService builds a concrete agent service implementation.
func NewService(components *Components, db *gorm.DB) *Service {
	return &Service{
		Components: components,
		DB:         db,
	}
}
