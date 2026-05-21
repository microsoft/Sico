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
	"sico-backend/internal/store/knowledge/repository"
	"sico-backend/internal/transport/http/dto/common"
	"sico-backend/internal/transport/http/dto/knowledge"
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
