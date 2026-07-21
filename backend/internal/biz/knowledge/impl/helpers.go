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

	"sico-backend/internal/infra/storage"
	"sico-backend/internal/store/knowledge/repository"
	"sico-backend/internal/transport/http/dto/common"
	"sico-backend/internal/transport/http/dto/knowledge"
	projectdto "sico-backend/internal/transport/http/dto/project"
	"sico-backend/pkg/logger"
)

func knowledgeTagModelToDTO(tag *repository.KnowledgeTagModel) *knowledge.KnowledgeTag {
	if tag == nil {
		return nil
	}

	return &knowledge.KnowledgeTag{
		Id:              tag.ID,
		ProjectId:       tag.ProjectID,
		Name:            tag.Name,
		Description:     tag.Description,
		CreatorUsername: tag.CreatorUsername,
		CreatedAt:       tag.CreatedAt,
		UpdatedAt:       tag.UpdatedAt,
	}
}

func documentModelToDTO(
	doc *repository.KnowledgeDocumentV2Model,
	attachment *common.Attachment,
	tags []*knowledge.KnowledgeTag,
	iconSasURL string,
) *knowledge.KnowledgeDocument {
	if doc == nil {
		return nil
	}

	return &knowledge.KnowledgeDocument{
		Id:              doc.ID,
		ProjectId:       doc.ProjectID,
		AgentId:         doc.AgentID,
		Name:            doc.Name,
		AssetId:         doc.AssetID,
		LinkUrl:         doc.LinkURL,
		DocumentType:    docTypeFromDB(doc.DocumentType),
		Status:          docStatusFromDB(doc.Status),
		FailReason:      doc.FailReason,
		CreatorUsername: doc.CreatorUsername,
		CreatedAt:       doc.CreatedAt,
		UpdatedAt:       doc.UpdatedAt,
		Attachment:      attachment,
		Tags:            tags,
		IconUri:         doc.IconURI,
		IconSasUrl:      iconSasURL,
	}
}

func playbookModelToDTO(
	pb *repository.KnowledgePlaybookModel,
	tags []*knowledge.KnowledgeTag,
) *knowledge.KnowledgePlaybook {
	if pb == nil {
		return nil
	}

	return &knowledge.KnowledgePlaybook{
		Id:              pb.ID,
		ProjectId:       pb.ProjectID,
		AgentInstanceId: pb.AgentInstanceID,
		Name:            pb.Name,
		CreatedAt:       pb.CreatedAt,
		UpdatedAt:       pb.UpdatedAt,
		Tags:            tags,
	}
}

// populatePlaybookExtraInfo fills ExtraInfo (agent name and icon) for a slice of playbook DTOs.
func (s *Service) populatePlaybookExtraInfo(ctx context.Context, playbooks []*knowledge.KnowledgePlaybook) {
	if s.AgentInstanceRepo == nil || len(playbooks) == 0 {
		return
	}

	ids := make([]int64, 0, len(playbooks))
	seen := make(map[int64]bool)
	for _, pb := range playbooks {
		if pb.AgentInstanceId != 0 && !seen[pb.AgentInstanceId] {
			ids = append(ids, pb.AgentInstanceId)
			seen[pb.AgentInstanceId] = true
		}
	}
	if len(ids) == 0 {
		return
	}

	instances, err := s.AgentInstanceRepo.MGet(ctx, ids)
	if err != nil {
		logger.CtxWarn(ctx, "populatePlaybookExtraInfo: failed to fetch agent instances: %v", err)
		return
	}

	instanceMap := make(map[int64]*common.AgentInstanceDigest, len(instances))
	for _, inst := range instances {
		iconURL, _ := storage.PathToUrl(inst.IconUri)
		instanceMap[inst.Id] = &common.AgentInstanceDigest{
			Id:               inst.Id,
			AgentName:        inst.Name,
			AgentIconUrl:     iconURL,
			OperatorUsername: inst.OperatorUsername,
		}
	}

	for _, pb := range playbooks {
		if info, ok := instanceMap[pb.AgentInstanceId]; ok {
			pb.ExtraInfo = &knowledge.KnowledgePlaybookExtraInfo{
				AgentInstance: info,
			}
		}
	}
}

// populateDeliverableExtraInfo fills ExtraInfo (agent name and icon) for a slice of deliverable DTOs.
func (s *Service) populateDeliverableExtraInfo(ctx context.Context, deliverables []*projectdto.ProjectDeliverable) {
	if s.AgentInstanceRepo == nil || len(deliverables) == 0 {
		return
	}

	ids := make([]int64, 0, len(deliverables))
	seen := make(map[int64]bool)
	for _, d := range deliverables {
		if d.AgentInstanceId != 0 && !seen[d.AgentInstanceId] {
			ids = append(ids, d.AgentInstanceId)
			seen[d.AgentInstanceId] = true
		}
	}
	if len(ids) == 0 {
		return
	}

	instances, err := s.AgentInstanceRepo.MGet(ctx, ids)
	if err != nil {
		logger.CtxWarn(ctx, "populateDeliverableExtraInfo: failed to fetch agent instances: %v", err)
		return
	}

	instanceMap := make(map[int64]*common.AgentInstanceDigest, len(instances))
	for _, inst := range instances {
		iconURL, _ := storage.PathToUrl(inst.IconUri)
		instanceMap[inst.Id] = &common.AgentInstanceDigest{
			Id:               inst.Id,
			AgentName:        inst.Name,
			AgentIconUrl:     iconURL,
			OperatorUsername: inst.OperatorUsername,
		}
	}

	for _, d := range deliverables {
		if info, ok := instanceMap[d.AgentInstanceId]; ok {
			d.ExtraInfo = &projectdto.ProjectDeliverableExtraInfo{
				AgentInstance: info,
			}
		}
	}
}
