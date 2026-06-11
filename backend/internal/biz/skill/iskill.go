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

package skill

import (
	"context"

	"sico-backend/internal/transport/http/dto/skill"
)

// Service defines the skill application contract consumed by transport handlers.
type Service interface {
	CreateSkill(ctx context.Context, req *skill.CreateSkillRequest) (*skill.CreateSkillResponse, error)
	GetSkill(ctx context.Context, req *skill.GetSkillRequest) (*skill.GetSkillResponse, error)
	UpdateSkill(ctx context.Context, req *skill.UpdateSkillRequest) (*skill.UpdateSkillResponse, error)
	DeleteSkill(ctx context.Context, req *skill.DeleteSkillRequest) (*skill.DeleteSkillResponse, error)
	ListSkills(ctx context.Context, req *skill.ListSkillRequest) (*skill.ListSkillResponse, error)
}

var defaultSvc Service

// Default returns the singleton skill application service.
func Default() Service {
	return defaultSvc
}

func setDefault(svc Service) {
	defaultSvc = svc
}
