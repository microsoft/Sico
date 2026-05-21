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
	"context"

	entity "sico-backend/internal/entity/agent/singleagent"
	"sico-backend/internal/infra/storage"
	"sico-backend/internal/transport/http/dto/project"
	"sico-backend/pkg/logger"
)

func uniqueProjectIDs(ids []int64) []int64 {
	seen := make(map[int64]struct{}, len(ids))
	unique := make([]int64, 0, len(ids))
	for _, id := range ids {
		if id <= 0 {
			continue
		}

		if _, ok := seen[id]; ok {
			continue
		}

		seen[id] = struct{}{}
		unique = append(unique, id)
	}
	return unique
}

func filterProjectIDs(ids []int64, projectID int64) []int64 {
	if projectID <= 0 {
		return uniqueProjectIDs(ids)
	}

	for _, id := range ids {
		if id == projectID {
			return []int64{projectID}
		}
	}

	return []int64{}
}

func (s *Service) fetchProjects(ctx context.Context, projectIDs []int64) map[int64]*project.Project {
	result := make(map[int64]*project.Project)
	ids := uniqueProjectIDs(projectIDs)
	if len(ids) == 0 {
		return result
	}
	if s.ProjectRepo == nil {
		logger.CtxWarn(ctx, "project repository not configured for agent service")
		return result
	}

	projects, err := s.ProjectRepo.GetProjectByIDs(ctx, ids)
	if err != nil {
		logger.CtxWarn(ctx, "failed to load projects: ids=%v err=%v", ids, err)
		return result
	}

	for _, p := range projects {
		if p == nil {
			continue
		}

		sasURL, err := storage.PathToUrl(p.IconURI)
		if err != nil {
			logger.CtxWarn(ctx, "failed to convert project icon uri: projectId=%d err=%v", p.ID, err)
		}

		result[p.ID] = &project.Project{
			Id:              p.ID,
			Name:            p.Name,
			Description:     p.Description,
			OwnerUsername:   p.OwnerUsername,
			CreatorUsername: p.CreatorUsername,
			CreatedAt:       p.CreatedAt,
			UpdatedAt:       p.UpdatedAt,
			IconSasUrl:      sasURL,
		}
	}

	return result
}

func (s *Service) populateSingleAgentInstanceProjects(ctx context.Context, instances ...*entity.SingleAgentInstance) {
	ids := make([]int64, 0, len(instances))
	for _, instance := range instances {
		ids = append(ids, instance.ProjectId)
	}

	projects := s.fetchProjects(ctx, ids)
	for _, instance := range instances {
		if projectInfo, ok := projects[instance.ProjectId]; ok {
			instance.Project = projectInfo
		}
	}
}
