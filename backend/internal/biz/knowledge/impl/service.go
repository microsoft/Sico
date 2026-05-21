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
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"strings"
	"time"

	"gorm.io/gorm"

	appresp "sico-backend/internal/biz/common/response"
	coregrpc "sico-backend/internal/infra/coregrpc"
	"sico-backend/internal/infra/storage"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/errcode"
	"sico-backend/internal/shared/types"
	agentrepo "sico-backend/internal/store/agent/singleagent/repository"
	"sico-backend/internal/store/knowledge/repository"
	projectrepo "sico-backend/internal/store/project/repository"
	knowledgegrpc "sico-backend/internal/transport/grpc/pb/knowledge"
	"sico-backend/internal/transport/http/dto/common"
	"sico-backend/internal/transport/http/dto/knowledge"
	"sico-backend/internal/transport/http/middleware"
	rgrpc "sico-backend/internal/transport/reverse_grpc/pb/knowledge"
	"sico-backend/pkg/logger"
	"sico-backend/pkg/safego"
)

const extractDocumentTimeout = 600 * time.Second

type Components struct {
	DocumentRepo      repository.DocumentRepository
	KnowledgeTagRepo  repository.KnowledgeTagRepository
	DocumentTagRepo   repository.DocumentTagRepository
	PlaybookRepo      repository.PlaybookRepository
	PlaybookTagRepo   repository.PlaybookTagRepository
	ProjectRepo       projectrepo.ProjectRepository
	AgentInstanceRepo agentrepo.SingleAgentInstanceRepository
	Storage           storage.Storage
	CoreGRPC          coregrpc.Connection
}

type Service struct {
	rgrpc.UnimplementedReverseKnowledgeRPCServer
	*Components
	grpcClient knowledgegrpc.KnowledgeServiceClient
}

func NewService(c *Components) *Service {
	svc := &Service{Components: c}

	if c != nil && c.CoreGRPC != nil {
		svc.grpcClient = knowledgegrpc.NewKnowledgeServiceClient(c.CoreGRPC)
	}

	return svc
}

func (s *Service) CreateDocument(
	ctx context.Context, req *knowledge.CreateKnowledgeDocumentRequest,
) (*knowledge.CreateKnowledgeDocumentResponse, error) {
	if req.ProjectId == 0 && req.AgentId == "" {
		return nil, apperr.New(errcode.CommonInvalidParam, "projectId or agentId is required")
	}

	if req.DocumentType == knowledge.KnowledgeDocumentType_KNOWLEDGE_DOCUMENT_TYPE_UNKNOWN {
		return nil, apperr.New(errcode.CommonInvalidParam, "documentType is required")
	}

	switch req.DocumentType {
	case knowledge.KnowledgeDocumentType_KNOWLEDGE_DOCUMENT_TYPE_FILE:
		if req.AssetId == 0 {
			return nil, apperr.New(errcode.CommonInvalidParam, "assetId is required for file document")
		}
	case knowledge.KnowledgeDocumentType_KNOWLEDGE_DOCUMENT_TYPE_LINK:
		if strings.TrimSpace(req.LinkUrl) == "" {
			return nil, apperr.New(errcode.CommonInvalidParam, "linkUrl is required for link document")
		}
	}

	name := s.deriveDocumentName(ctx, req)
	creator := middleware.MustGetUsernameFromCtx(ctx)

	doc := &repository.KnowledgeDocumentV2Model{
		ProjectID:       req.ProjectId,
		AgentID:         req.AgentId,
		Name:            name,
		AssetID:         req.AssetId,
		IconURI:         req.IconUri,
		LinkURL:         req.LinkUrl,
		DocumentType:    docTypeToDB(req.DocumentType),
		Status:          docStatusToDB(knowledge.KnowledgeDocumentStatus_KNOWLEDGE_DOCUMENT_STATUS_UPLOADED),
		FailReason:      "",
		CreatorUsername: creator,
	}

	id, err := s.DocumentRepo.Create(ctx, doc)
	if err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return nil, apperr.New(errcode.CommonConflict, "knowledge document already exists")
		}
		return nil, err
	}

	if s.DocumentTagRepo != nil && req.TagIds != nil {
		if err := s.DocumentTagRepo.CreateDocumentTags(ctx, id, req.TagIds); err != nil {
			return nil, err
		}
	}

	s.triggerExtractDocument(ctx, doc)

	return appresp.Success(&knowledge.CreateKnowledgeDocumentResponse{
		Data: &knowledge.CreateKnowledgeDocumentData{Id: id},
	}), nil
}

func (s *Service) GetDocument(
	ctx context.Context, req *knowledge.GetKnowledgeDocumentRequest,
) (*knowledge.GetKnowledgeDocumentResponse, error) {
	doc, err := s.DocumentRepo.GetByID(ctx, req.Id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperr.New(errcode.CommonNotFound, "knowledge document not found")
		}
		return nil, err
	}

	tags, err := s.DocumentTagRepo.GetTagsByDocumentID(ctx, req.Id)
	if err != nil {
		return nil, err
	}
	var tagDTOs []*knowledge.KnowledgeTag
	for _, t := range tags {
		tagDTOs = append(tagDTOs, knowledgeTagModelToDTO(t))
	}

	attachment, err := s.buildAttachment(ctx, doc)
	if err != nil {
		return nil, err
	}

	iconSasURL := s.buildIconSAS(ctx, doc.IconURI)

	return appresp.Success(&knowledge.GetKnowledgeDocumentResponse{
		Data: &knowledge.GetKnowledgeDocumentData{
			Document: documentModelToDTO(doc, attachment, tagDTOs, iconSasURL),
		},
	}), nil
}

func (s *Service) GetDocumentDetails(
	ctx context.Context, req *knowledge.GetKnowledgeDocumentDetailsRequest,
) (*knowledge.GetKnowledgeDocumentDetailsResponse, error) {
	if req.Id == 0 {
		return nil, apperr.New(errcode.CommonInvalidParam, "id is required")
	}

	if s.DocumentRepo == nil {
		return nil, apperr.New(errcode.CommonUnavailable, "knowledge document repository not initialized")
	}

	doc, err := s.DocumentRepo.GetByID(ctx, req.Id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperr.New(errcode.CommonNotFound, "knowledge document not found")
		}
		return nil, err
	}

	if s.grpcClient == nil {
		return nil, apperr.New(errcode.CommonUnavailable, "core gRPC client not initialized")
	}

	if doc.Status != docStatusToDB(knowledge.KnowledgeDocumentStatus_KNOWLEDGE_DOCUMENT_STATUS_INGESTED) {
		return nil, apperr.New(errcode.CommonInvalidParam, "knowledge document not ingested")
	}

	grpcReq := &knowledgegrpc.GetDocumentDetailsRequest{
		DocumentId: req.Id,
		ProjectId:  doc.ProjectID,
		AgentId:    doc.AgentID,
	}

	resp, err := s.grpcClient.GetDocumentDetails(ctx, grpcReq)
	if err != nil {
		return nil, err
	}

	if resp == nil {
		return nil, apperr.New(errcode.CommonInternalError, "empty response from core knowledge service")
	}

	if resp.Code != 0 {
		msg := resp.Msg
		if msg == "" {
			msg = "failed to fetch document details"
		}
		return nil, apperr.New(errcode.CommonInternalError, msg)
	}

	return appresp.Success(&knowledge.GetKnowledgeDocumentDetailsResponse{
		Data: &knowledge.GetKnowledgeDocumentDetailsData{
			Summary:  resp.Summary,
			FullText: resp.FullText,
		},
	}), nil
}

func (s *Service) UpdateDocument(
	ctx context.Context, req *knowledge.UpdateKnowledgeDocumentRequest,
) (*knowledge.UpdateKnowledgeDocumentResponse, error) {
	doc, err := s.DocumentRepo.GetByID(ctx, req.Id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperr.New(errcode.CommonNotFound, "knowledge document not found")
		}
		return nil, err
	}

	applyDocumentUpdates(doc, req)

	if err := s.DocumentRepo.Update(ctx, doc); err != nil {
		return nil, err
	}

	if err := s.syncDocumentTags(ctx, req); err != nil {
		return nil, err
	}

	s.triggerExtractDocument(ctx, doc)

	return appresp.Success(&knowledge.UpdateKnowledgeDocumentResponse{}), nil
}

func applyDocumentUpdates(doc *repository.KnowledgeDocumentV2Model, req *knowledge.UpdateKnowledgeDocumentRequest) {
	if req.AgentId != "" {
		doc.AgentID = req.AgentId
	}
	if req.AssetId != 0 {
		doc.AssetID = req.AssetId
	}
	if req.LinkUrl != "" {
		doc.LinkURL = req.LinkUrl
	}
	if req.IconUri != "" {
		doc.IconURI = req.IconUri
	}
	if name := strings.TrimSpace(req.Name); name != "" {
		doc.Name = name
	}
	if req.DocumentType != knowledge.KnowledgeDocumentType_KNOWLEDGE_DOCUMENT_TYPE_UNKNOWN {
		doc.DocumentType = docTypeToDB(req.DocumentType)
	}
	if req.Status != knowledge.KnowledgeDocumentStatus_KNOWLEDGE_DOCUMENT_STATUS_UNKNOWN {
		doc.Status = docStatusToDB(req.Status)
	}
	if req.FailReason != "" {
		doc.FailReason = req.FailReason
	}
}

func (s *Service) syncDocumentTags(ctx context.Context, req *knowledge.UpdateKnowledgeDocumentRequest) error {
	if s.DocumentTagRepo == nil || req.TagIds == nil {
		return nil
	}
	if err := s.DocumentTagRepo.DeleteDocumentTags(ctx, req.Id); err != nil {
		return err
	}
	if len(req.TagIds) == 0 {
		return nil
	}
	return s.DocumentTagRepo.CreateDocumentTags(ctx, req.Id, req.TagIds)
}

func (s *Service) DeleteDocument(
	ctx context.Context, req *knowledge.DeleteKnowledgeDocumentRequest,
) (*knowledge.DeleteKnowledgeDocumentResponse, error) {
	if _, err := s.DocumentRepo.GetByID(ctx, req.Id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperr.New(errcode.CommonNotFound, "knowledge document not found")
		}
		return nil, err
	}

	if err := s.DocumentRepo.Delete(ctx, req.Id); err != nil {
		return nil, err
	}

	if s.DocumentTagRepo != nil {
		if err := s.DocumentTagRepo.DeleteDocumentTags(ctx, req.Id); err != nil {
			return nil, err
		}
	}

	return appresp.Success(&knowledge.DeleteKnowledgeDocumentResponse{}), nil
}

func (s *Service) ListDocuments(
	ctx context.Context, req *knowledge.ListKnowledgeDocumentRequest,
) (*knowledge.ListKnowledgeDocumentResponse, error) {
	offset := int(req.Page-1) * int(req.PageSize)
	filter := &repository.DocumentV2Filter{
		ProjectID:       req.ProjectId,
		AgentID:         req.AgentId,
		AssetID:         req.AssetId,
		LinkURL:         req.LinkUrl,
		DocumentType:    docTypeToDB(req.DocumentType),
		Status:          docStatusToDB(req.Status),
		CreatorUsername: req.CreatorUsername,
		Offset:          offset,
		Limit:           int(req.PageSize),
	}

	docs, total, err := s.DocumentRepo.List(ctx, filter)
	if err != nil {
		return nil, err
	}

	assetCache := make(map[int64]*common.Attachment)
	result := make([]*knowledge.KnowledgeDocument, 0, len(docs))
	for _, doc := range docs {
		att, ok := assetCache[doc.AssetID]
		if !ok {
			att, err = s.buildAttachment(ctx, doc)
			if err != nil {
				return nil, err
			}
			assetCache[doc.AssetID] = att
		}

		tags, err := s.DocumentTagRepo.GetTagsByDocumentID(ctx, doc.ID)
		if err != nil {
			return nil, err
		}
		var tagDTOs []*knowledge.KnowledgeTag
		for _, t := range tags {
			tagDTOs = append(tagDTOs, knowledgeTagModelToDTO(t))
		}

		iconSasURL := s.buildIconSAS(ctx, doc.IconURI)

		result = append(result, documentModelToDTO(doc, att, tagDTOs, iconSasURL))
	}

	hasNext := int64(offset+len(docs)) < total
	return appresp.Success(&knowledge.ListKnowledgeDocumentResponse{
		Data: &knowledge.ListKnowledgeDocumentData{
			Documents: result,
			Total:     int32(total),
			HasNext:   hasNext,
		},
	}), nil
}

func (s *Service) CreateKnowledgeTag(
	ctx context.Context, req *knowledge.CreateKnowledgeTagRequest,
) (*knowledge.CreateKnowledgeTagResponse, error) {
	if req.ProjectId == 0 || strings.TrimSpace(req.Name) == "" {
		return nil, apperr.New(errcode.CommonInvalidParam, "projectId and name are required")
	}

	creator := middleware.MustGetUsernameFromCtx(ctx)

	tag := &repository.KnowledgeTagModel{
		ProjectID:       req.ProjectId,
		Name:            req.Name,
		Description:     req.Description,
		CreatorUsername: creator,
	}

	id, err := s.KnowledgeTagRepo.Create(ctx, tag)
	if err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return nil, apperr.New(errcode.CommonConflict, "knowledge tag already exists")
		}
		return nil, err
	}

	return appresp.Success(&knowledge.CreateKnowledgeTagResponse{
		Data: &knowledge.CreateKnowledgeTagData{Id: id},
	}), nil
}

func (s *Service) UpdateKnowledgeTag(
	ctx context.Context, req *knowledge.UpdateKnowledgeTagRequest,
) (*knowledge.UpdateKnowledgeTagResponse, error) {
	tag, err := s.KnowledgeTagRepo.GetByID(ctx, req.Id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperr.New(errcode.CommonNotFound, "knowledge tag not found")
		}
		return nil, err
	}

	if req.Name != "" {
		tag.Name = req.Name
	}
	if req.Description != "" {
		tag.Description = req.Description
	}

	if err := s.KnowledgeTagRepo.Update(ctx, tag); err != nil {
		return nil, err
	}

	return appresp.Success(&knowledge.UpdateKnowledgeTagResponse{}), nil
}

func (s *Service) DeleteKnowledgeTag(
	ctx context.Context, req *knowledge.DeleteKnowledgeTagRequest,
) (*knowledge.DeleteKnowledgeTagResponse, error) {
	if _, err := s.KnowledgeTagRepo.GetByID(ctx, req.Id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperr.New(errcode.CommonNotFound, "knowledge tag not found")
		}
		return nil, err
	}

	if err := s.KnowledgeTagRepo.Delete(ctx, req.Id); err != nil {
		return nil, err
	}
	return appresp.Success(&knowledge.DeleteKnowledgeTagResponse{}), nil
}

func (s *Service) GetKnowledgeTag(
	ctx context.Context, req *knowledge.GetKnowledgeTagRequest,
) (*knowledge.GetKnowledgeTagResponse, error) {
	tag, err := s.KnowledgeTagRepo.GetByID(ctx, req.Id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperr.New(errcode.CommonNotFound, "knowledge tag not found")
		}
		return nil, err
	}

	return appresp.Success(&knowledge.GetKnowledgeTagResponse{
		Data: &knowledge.GetKnowledgeTagData{Tag: knowledgeTagModelToDTO(tag)},
	}), nil
}

func (s *Service) triggerExtractDocument(
	ctx context.Context, doc *repository.KnowledgeDocumentV2Model,
) {
	if doc == nil || doc.ID == 0 || s.grpcClient == nil {
		return
	}

	safego.Go(ctx, func() {
		reqCtx, cancel := context.WithTimeout(context.Background(), extractDocumentTimeout)
		defer cancel()

		dto, err := s.buildDocumentDTO(reqCtx, doc)
		if err != nil {
			logger.CtxWarn(
				ctx,
				"knowledge: failed to build document payload for extraction: id=%d err=%v",
				doc.ID, err,
			)
			return
		}
		if dto == nil {
			return
		}

		resp, err := s.grpcClient.ExtractDocument(reqCtx, dto)
		status := knowledge.KnowledgeDocumentStatus_KNOWLEDGE_DOCUMENT_STATUS_INGESTED
		failReason := ""
		if err != nil || resp == nil || resp.Code != 0 {
			status = knowledge.KnowledgeDocumentStatus_KNOWLEDGE_DOCUMENT_STATUS_FAILED
			if err != nil {
				failReason = err.Error()
				logger.CtxWarn(ctx, "knowledge: gRPC extract document failed: id=%d err=%v", doc.ID, err)
			} else if resp != nil && resp.Message != "" {
				failReason = resp.Message
			} else {
				failReason = "extraction failed"
			}
		}

		if updateErr := s.updateDocumentStatus(reqCtx, doc.ID, status, failReason); updateErr != nil {
			logger.CtxWarn(
				ctx,
				"knowledge: failed to update status after extract: id=%d err=%v",
				doc.ID, updateErr,
			)
		}
	})
}

func (s *Service) updateDocumentStatus(
	ctx context.Context, docID int64,
	status knowledge.KnowledgeDocumentStatus, failReason string,
) error {
	if s.DocumentRepo == nil {
		return nil
	}

	doc, err := s.DocumentRepo.GetByID(ctx, docID)
	if err != nil {
		return err
	}

	doc.Status = docStatusToDB(status)
	doc.FailReason = failReason

	return s.DocumentRepo.Update(ctx, doc)
}

func (s *Service) buildDocumentDTO(
	ctx context.Context, doc *repository.KnowledgeDocumentV2Model,
) (*knowledge.KnowledgeDocument, error) {
	if doc == nil {
		return nil, nil
	}

	var tagDTOs []*knowledge.KnowledgeTag
	if s.DocumentTagRepo != nil {
		tags, err := s.DocumentTagRepo.GetTagsByDocumentID(ctx, doc.ID)
		if err != nil {
			return nil, err
		}
		for _, t := range tags {
			tagDTOs = append(tagDTOs, knowledgeTagModelToDTO(t))
		}
	}

	attachment, err := s.buildAttachment(ctx, doc)
	if err != nil {
		return nil, err
	}

	iconSasURL := s.buildIconSAS(ctx, doc.IconURI)

	return documentModelToDTO(doc, attachment, tagDTOs, iconSasURL), nil
}

func (s *Service) ListKnowledgeTag(
	ctx context.Context, req *knowledge.ListKnowledgeTagRequest,
) (*knowledge.ListKnowledgeTagResponse, error) {
	offset := int(req.Page-1) * int(req.PageSize)
	tags, total, err := s.KnowledgeTagRepo.List(ctx, req.ProjectId, offset, int(req.PageSize))
	if err != nil {
		return nil, err
	}

	result := make([]*knowledge.KnowledgeTag, 0, len(tags))
	for _, t := range tags {
		result = append(result, knowledgeTagModelToDTO(t))
	}

	hasNext := int64(offset+len(tags)) < total
	return appresp.Success(&knowledge.ListKnowledgeTagResponse{
		Data: &knowledge.ListKnowledgeTagData{
			Tags:    result,
			Total:   int32(total),
			HasNext: hasNext,
		},
	}), nil
}

func docTypeToDB(t knowledge.KnowledgeDocumentType) int32 {
	switch t {
	case knowledge.KnowledgeDocumentType_KNOWLEDGE_DOCUMENT_TYPE_FILE:
		return 1
	case knowledge.KnowledgeDocumentType_KNOWLEDGE_DOCUMENT_TYPE_LINK:
		return 2
	default:
		return 0
	}
}

func docStatusToDB(s knowledge.KnowledgeDocumentStatus) int32 {
	switch s {
	case knowledge.KnowledgeDocumentStatus_KNOWLEDGE_DOCUMENT_STATUS_FAILED:
		return 1
	case knowledge.KnowledgeDocumentStatus_KNOWLEDGE_DOCUMENT_STATUS_UPLOADED:
		return 2
	case knowledge.KnowledgeDocumentStatus_KNOWLEDGE_DOCUMENT_STATUS_INGESTED:
		return 3
	default:
		return 0
	}
}

func docTypeFromDB(v int32) knowledge.KnowledgeDocumentType {
	switch v {
	case 1:
		return knowledge.KnowledgeDocumentType_KNOWLEDGE_DOCUMENT_TYPE_FILE
	case 2:
		return knowledge.KnowledgeDocumentType_KNOWLEDGE_DOCUMENT_TYPE_LINK
	default:
		return knowledge.KnowledgeDocumentType_KNOWLEDGE_DOCUMENT_TYPE_UNKNOWN
	}
}

func docStatusFromDB(v int32) knowledge.KnowledgeDocumentStatus {
	switch v {
	case 1:
		return knowledge.KnowledgeDocumentStatus_KNOWLEDGE_DOCUMENT_STATUS_FAILED
	case 2:
		return knowledge.KnowledgeDocumentStatus_KNOWLEDGE_DOCUMENT_STATUS_UPLOADED
	case 3:
		return knowledge.KnowledgeDocumentStatus_KNOWLEDGE_DOCUMENT_STATUS_INGESTED
	default:
		return knowledge.KnowledgeDocumentStatus_KNOWLEDGE_DOCUMENT_STATUS_UNKNOWN
	}
}

func (s *Service) buildAttachment(
	ctx context.Context, doc *repository.KnowledgeDocumentV2Model,
) (*common.Attachment, error) {
	if doc == nil || doc.AssetID == 0 || s.ProjectRepo == nil || s.Storage == nil {
		return nil, nil
	}

	asset, err := s.ProjectRepo.GetProjectAsset(ctx, doc.AssetID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}

	uriPath := fmt.Sprintf("%s/%s", asset.ProjectID, asset.ObjectKey)
	sasURL, err := storage.PathToUrl(uriPath)
	if err != nil {
		logger.CtxWarn(ctx, "failed to get sas url for knowledge attachment: uri=%s err=%v", uriPath, err)
		sasURL = ""
	}

	var extra types.FileExtraInfo
	if asset.Extra != "" {
		_ = json.Unmarshal([]byte(asset.Extra), &extra)
	}

	return &common.Attachment{
		Id:     asset.ID,
		Name:   extra.FileName,
		Uri:    uriPath,
		SasUrl: sasURL,
		Type:   extra.FileType,
		Size:   extra.FileSize,
	}, nil
}

func (s *Service) buildIconSAS(ctx context.Context, iconURI string) string {
	if iconURI == "" || s.Storage == nil {
		return ""
	}

	sasURL, err := storage.PathToUrl(iconURI)
	if err != nil {
		logger.CtxWarn(ctx, "failed to get sas url for knowledge icon: uri=%s err=%v", iconURI, err)
		return ""
	}

	return sasURL
}

// region Reverse RPC

func (s *Service) RpcListKnowledgeMetadata(
	ctx context.Context, req *rgrpc.GetKnowledgeMetadataRequest,
) (*rgrpc.GetKnowledgeMetadataResponse, error) {
	if s.DocumentRepo == nil {
		return nil, fmt.Errorf("knowledge document repository not initialized")
	}

	if req == nil || len(req.GetKnowledgeIds()) == 0 {
		return &rgrpc.GetKnowledgeMetadataResponse{Data: nil}, nil
	}

	seen := make(map[int64]struct{}, len(req.GetKnowledgeIds()))
	data := make([]*rgrpc.KnowledgeMetadata, 0, len(req.GetKnowledgeIds()))

	for _, id := range req.GetKnowledgeIds() {
		if id == 0 {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}

		doc, err := s.DocumentRepo.GetByID(ctx, id)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				logger.CtxWarn(ctx, "knowledge metadata: document not found: id=%d", id)
				continue
			}
			return nil, fmt.Errorf("failed to get knowledge document %d: %w", id, err)
		}

		tags, err := s.fetchTagNames(ctx, id)
		if err != nil {
			return nil, fmt.Errorf("failed to load tags for knowledge document %d: %w", id, err)
		}

		data = append(data, &rgrpc.KnowledgeMetadata{
			KnowledgeId: doc.ID,
			Name:        s.resolveDocumentName(ctx, doc),
			Tags:        tags,
		})
	}

	return &rgrpc.GetKnowledgeMetadataResponse{Data: data, Code: 0, Msg: ""}, nil
}

func (s *Service) RpcUpsertKnowledgePlaybook(
	ctx context.Context, req *rgrpc.UpsertKnowledgePlaybookRequest,
) (*rgrpc.UpsertKnowledgePlaybookResponse, error) {
	if s.PlaybookRepo == nil {
		return nil, fmt.Errorf("playbook repository not initialized")
	}

	if req.GetProjectId() == 0 || req.GetAgentInstanceId() == 0 {
		return &rgrpc.UpsertKnowledgePlaybookResponse{
			Code: 1,
			Msg:  "project_id and agent_instance_id are required",
		}, nil
	}

	existing, err := s.PlaybookRepo.GetByProjectAndAgent(ctx, req.GetProjectId(), req.GetAgentInstanceId())
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, fmt.Errorf("failed to look up playbook: %w", err)
	}

	if existing != nil {
		// Playbook already exists – touch updated_at.
		if err := s.PlaybookRepo.Update(ctx, existing); err != nil {
			return nil, fmt.Errorf("failed to update playbook timestamp: %w", err)
		}
		logger.CtxInfo(ctx, "RpcUpsertKnowledgePlaybook: updated existing playbook id=%d", existing.ID)
		return &rgrpc.UpsertKnowledgePlaybookResponse{
			PlaybookId: existing.ID,
			Created:    false,
			Code:       0,
		}, nil
	}

	// Derive playbook name from agent instance.
	playbookName := "Experiences"
	if s.AgentInstanceRepo != nil {
		if inst, err := s.AgentInstanceRepo.Get(ctx, req.GetAgentInstanceId()); err == nil && inst != nil {
			playbookName = fmt.Sprintf("Experiences for %s %s", inst.Role, inst.Name)
		} else {
			logger.CtxWarn(
				ctx,
				"RpcUpsertKnowledgePlaybook: failed to get agent instance %d: %v",
				req.GetAgentInstanceId(), err,
			)
		}
	}

	// Create a new playbook record.
	newPb := &repository.KnowledgePlaybookModel{
		ProjectID:       req.GetProjectId(),
		AgentInstanceID: req.GetAgentInstanceId(),
		Name:            playbookName,
	}
	id, err := s.PlaybookRepo.Create(ctx, newPb)
	if err != nil {
		return nil, fmt.Errorf("failed to create playbook: %w", err)
	}
	logger.CtxInfo(ctx, "RpcUpsertKnowledgePlaybook: created new playbook id=%d for project=%d agent=%d",
		id, req.GetProjectId(), req.GetAgentInstanceId())
	return &rgrpc.UpsertKnowledgePlaybookResponse{
		PlaybookId: id,
		Created:    true,
		Code:       0,
	}, nil
}

func (s *Service) fetchTagNames(ctx context.Context, docID int64) ([]string, error) {
	if s.DocumentTagRepo == nil {
		return nil, nil
	}

	tags, err := s.DocumentTagRepo.GetTagsByDocumentID(ctx, docID)
	if err != nil {
		return nil, err
	}

	names := make([]string, 0, len(tags))
	for _, tag := range tags {
		if tag != nil {
			names = append(names, tag.Name)
		}
	}

	return names, nil
}

func (s *Service) resolveDocumentName(ctx context.Context, doc *repository.KnowledgeDocumentV2Model) string {
	if doc == nil {
		return ""
	}

	if name := strings.TrimSpace(doc.Name); name != "" {
		return name
	}

	if docTypeFromDB(doc.DocumentType) == knowledge.KnowledgeDocumentType_KNOWLEDGE_DOCUMENT_TYPE_FILE &&
		doc.AssetID > 0 && s.ProjectRepo != nil {
		if name := s.lookupAssetName(ctx, doc.AssetID); name != "" {
			return name
		}
	}

	if doc.LinkURL != "" {
		return doc.LinkURL
	}

	return fmt.Sprintf("knowledge-%d", doc.ID)
}

func (s *Service) deriveDocumentName(ctx context.Context, req *knowledge.CreateKnowledgeDocumentRequest) string {
	if req == nil {
		return ""
	}

	if name := strings.TrimSpace(req.Name); name != "" {
		return name
	}

	switch req.DocumentType {
	case knowledge.KnowledgeDocumentType_KNOWLEDGE_DOCUMENT_TYPE_FILE:
		return s.deriveFileDocumentName(ctx, req.AssetId)
	case knowledge.KnowledgeDocumentType_KNOWLEDGE_DOCUMENT_TYPE_LINK:
		return "Untitled link"
	}

	return ""
}

func (s *Service) deriveFileDocumentName(ctx context.Context, assetID int64) string {
	if assetID <= 0 {
		return ""
	}
	name := s.lookupAssetName(ctx, assetID)
	if name == "" {
		return ""
	}
	clean := strings.TrimSpace(name)
	base := path.Base(clean)
	if base == "" {
		base = clean
	}
	if ext := path.Ext(base); ext != "" {
		base = strings.TrimSuffix(base, ext)
	}
	return strings.TrimSpace(base)
}

func (s *Service) lookupAssetName(ctx context.Context, assetID int64) string {
	if assetID == 0 || s.ProjectRepo == nil {
		return ""
	}

	asset, err := s.ProjectRepo.GetProjectAsset(ctx, assetID)
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			logger.CtxWarn(ctx, "knowledge metadata: failed to load asset: asset_id=%d err=%v", assetID, err)
		}
		return ""
	}

	var extra types.FileExtraInfo
	if asset.Extra != "" {
		if err := json.Unmarshal([]byte(asset.Extra), &extra); err != nil {
			logger.CtxWarn(ctx, "knowledge metadata: failed to parse asset extra: asset_id=%d err=%v", asset.ID, err)
		}
	}

	if extra.FileName != "" {
		return extra.FileName
	}
	if asset.ObjectKey != "" {
		return asset.ObjectKey
	}

	return ""
}

func (s *Service) GetPlaybook(
	ctx context.Context, req *knowledge.GetKnowledgePlaybookRequest,
) (*knowledge.GetKnowledgePlaybookResponse, error) {
	if req.Id == 0 {
		return nil, apperr.New(errcode.CommonInvalidParam, "id is required")
	}

	if s.PlaybookRepo == nil {
		return nil, apperr.New(errcode.CommonUnavailable, "playbook repository not initialized")
	}

	playbook, err := s.PlaybookRepo.GetByID(ctx, req.Id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperr.New(errcode.CommonNotFound, "playbook not found")
		}
		return nil, err
	}

	tags, err := s.fetchPlaybookTags(ctx, playbook.ID)
	if err != nil {
		return nil, err
	}

	return appresp.Success(&knowledge.GetKnowledgePlaybookResponse{
		Data: &knowledge.GetKnowledgePlaybookData{
			Playbook: playbookModelToDTO(playbook, tags),
		},
	}), nil
}

func (s *Service) ListPlaybooks(
	ctx context.Context, req *knowledge.ListKnowledgePlaybookRequest,
) (*knowledge.ListKnowledgePlaybookResponse, error) {
	if s.PlaybookRepo == nil {
		return nil, apperr.New(errcode.CommonUnavailable, "playbook repository not initialized")
	}

	offset := int(req.Page-1) * int(req.PageSize)
	filter := &repository.PlaybookFilter{
		ProjectID:       req.ProjectId,
		AgentInstanceID: req.AgentInstanceId,
		Offset:          offset,
		Limit:           int(req.PageSize),
	}

	playbooks, total, err := s.PlaybookRepo.List(ctx, filter)
	if err != nil {
		return nil, err
	}

	result := make([]*knowledge.KnowledgePlaybook, 0, len(playbooks))
	for _, pb := range playbooks {
		tags, err := s.fetchPlaybookTags(ctx, pb.ID)
		if err != nil {
			return nil, err
		}
		result = append(result, playbookModelToDTO(pb, tags))
	}

	hasNext := int64(offset+len(playbooks)) < total
	return appresp.Success(&knowledge.ListKnowledgePlaybookResponse{
		Data: &knowledge.ListKnowledgePlaybookData{
			Playbooks: result,
			Total:     int32(total),
			HasNext:   hasNext,
		},
	}), nil
}

func (s *Service) UpdatePlaybook(
	ctx context.Context, req *knowledge.UpdateKnowledgePlaybookRequest,
) (*knowledge.UpdateKnowledgePlaybookResponse, error) {
	if req.Id == 0 {
		return nil, apperr.New(errcode.CommonInvalidParam, "id is required")
	}

	if s.PlaybookRepo == nil {
		return nil, apperr.New(errcode.CommonUnavailable, "playbook repository not initialized")
	}

	playbook, err := s.PlaybookRepo.GetByID(ctx, req.Id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperr.New(errcode.CommonNotFound, "playbook not found")
		}
		return nil, err
	}

	if name := strings.TrimSpace(req.Name); name != "" {
		playbook.Name = name
	}

	if err := s.PlaybookRepo.Update(ctx, playbook); err != nil {
		return nil, err
	}

	if s.PlaybookTagRepo != nil && req.TagIds != nil {
		if err := s.PlaybookTagRepo.DeletePlaybookTags(ctx, req.Id); err != nil {
			return nil, err
		}
		if len(req.TagIds) > 0 {
			if err := s.PlaybookTagRepo.CreatePlaybookTags(ctx, req.Id, req.TagIds); err != nil {
				return nil, err
			}
		}
	}

	return appresp.Success(&knowledge.UpdateKnowledgePlaybookResponse{}), nil
}

func (s *Service) GetPlaybookDetails(
	ctx context.Context, req *knowledge.GetKnowledgePlaybookDetailsRequest,
) (*knowledge.GetKnowledgePlaybookDetailsResponse, error) {
	if req.Id == 0 {
		return nil, apperr.New(errcode.CommonInvalidParam, "id is required")
	}

	if s.PlaybookRepo == nil {
		return nil, apperr.New(errcode.CommonUnavailable, "playbook repository not initialized")
	}

	playbook, err := s.PlaybookRepo.GetByID(ctx, req.Id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperr.New(errcode.CommonNotFound, "playbook not found")
		}
		return nil, err
	}

	if s.grpcClient == nil {
		return nil, apperr.New(errcode.CommonUnavailable, "core gRPC client not initialized")
	}

	grpcReq := &knowledgegrpc.GetKnowledgePlaybookDetailsGrpcRequest{
		PlaybookId:      playbook.ID,
		ProjectId:       playbook.ProjectID,
		AgentInstanceId: playbook.AgentInstanceID,
	}

	resp, err := s.grpcClient.GetPlaybookDetails(ctx, grpcReq)
	if err != nil {
		return nil, err
	}

	if resp == nil {
		return nil, apperr.New(errcode.CommonInternalError, "empty response from core knowledge service")
	}

	if resp.Code != 0 {
		msg := resp.Msg
		if msg == "" {
			msg = "failed to fetch playbook details"
		}
		return nil, apperr.New(errcode.CommonInternalError, msg)
	}

	playbookName := playbook.Name
	if s.AgentInstanceRepo != nil {
		if inst, err := s.AgentInstanceRepo.Get(ctx, playbook.AgentInstanceID); err == nil && inst != nil {
			playbookName = fmt.Sprintf("Experiences for %s %s", inst.Role, inst.Name)
		}
	}

	return appresp.Success(&knowledge.GetKnowledgePlaybookDetailsResponse{
		Data: &knowledge.GetKnowledgePlaybookDetailsData{
			Content: resp.Content,
			Name:    playbookName,
		},
	}), nil
}

func (s *Service) fetchPlaybookTags(ctx context.Context, playbookID int64) ([]*knowledge.KnowledgeTag, error) {
	if s.PlaybookTagRepo == nil {
		return nil, nil
	}

	tagModels, err := s.PlaybookTagRepo.GetTagsByPlaybookID(ctx, playbookID)
	if err != nil {
		return nil, err
	}

	tags := make([]*knowledge.KnowledgeTag, 0, len(tagModels))
	for _, t := range tagModels {
		tags = append(tags, knowledgeTagModelToDTO(t))
	}
	return tags, nil
}
