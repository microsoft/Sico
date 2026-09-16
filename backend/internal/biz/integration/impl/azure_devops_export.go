package impl

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	appresp "sico-backend/internal/biz/common/response"
	"sico-backend/internal/biz/integration/azuredevops"
	"sico-backend/internal/biz/project"
	"sico-backend/internal/biz/rbac"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/errcode"
	integrationdto "sico-backend/internal/transport/http/dto/integration"
	knowledgedto "sico-backend/internal/transport/http/dto/knowledge"
	projectdto "sico-backend/internal/transport/http/dto/project"
	"sico-backend/pkg/logger"
)

func (s *Service) ListAzureDevOpsExportFields(
	ctx context.Context,
	req *integrationdto.ListAzureDevOpsExportFieldsRequest,
	actor string,
) (*integrationdto.ListAzureDevOpsExportFieldsResponse, error) {
	if err := s.requireAzureDevOps(); err != nil {
		return nil, err
	}

	access, err := s.azureSharedProjectAccess(
		ctx,
		req.ConnectionKey,
		req.SicoProjectId,
		req.ResourceKey,
		actor,
	)
	if err != nil {
		return nil, err
	}

	fields, err := s.AzureDevOps.ListExportFields(
		ctx,
		access.credentialBundle.AccessToken,
		access.project.OrganizationName,
		access.project.ID,
	)
	if err != nil {
		return nil, mapAzureError(err)
	}

	items := make([]*integrationdto.AzureDevOpsExportField, 0, len(fields))
	for _, field := range fields {
		items = append(items, &integrationdto.AzureDevOpsExportField{
			Name:          field.Name,
			ReferenceName: field.ReferenceName,
			Type:          field.Type,
			Required:      field.Required,
			Group:         field.Group,
		})
	}

	return appresp.Success(&integrationdto.ListAzureDevOpsExportFieldsResponse{
		Data: &integrationdto.ListAzureDevOpsExportFieldsData{
			Fields:             items,
			CanImportKnowledge: s.authorizeKnowledgeImport(ctx, req.SicoProjectId, actor) == nil,
			MaxWorkItems:       azuredevops.MaxExportWorkItems,
			MaxFileBytes:       azuredevops.MaxExportBytes,
		},
	}), nil
}

func (s *Service) ExportAzureDevOpsQuery(
	ctx context.Context,
	req *integrationdto.ExportAzureDevOpsQueryRequest,
	actor string,
) (*azuredevops.QueryExport, error) {
	if err := s.requireAzureDevOps(); err != nil {
		return nil, err
	}

	access, err := s.azureSharedProjectAccess(
		ctx,
		req.ConnectionKey,
		req.SicoProjectId,
		req.ResourceKey,
		actor,
	)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()

	export, err := s.AzureDevOps.ExportSavedQueryFile(
		ctx,
		access.credentialBundle.AccessToken,
		*access.project,
		req.QueryId,
		azuredevops.ExportOptions{
			ColumnOptions: req.ColumnOptions,
		},
	)
	if err != nil {
		return nil, mapAzureError(err)
	}

	return export, nil
}

func (s *Service) ImportAzureDevOpsKnowledge(
	ctx context.Context,
	req *integrationdto.ImportAzureDevOpsKnowledgeRequest,
	actor string,
) (*integrationdto.ImportAzureDevOpsKnowledgeResponse, error) {
	if err := s.validateKnowledgeImport(ctx, req, actor); err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 4*time.Minute)
	defer cancel()

	claim, cached, err := s.claimKnowledgeImport(ctx, req, actor)
	if err != nil || cached != nil {
		return cached, err
	}

	export, err := s.ExportAzureDevOpsQuery(ctx, req.Export, actor)
	if err != nil {
		s.releaseKnowledgeImport(ctx, claim)
		return nil, err
	}

	response, err := s.saveAzureDevOpsKnowledge(ctx, req, actor, export)
	if err != nil {
		return nil, err
	}

	if err := s.completeKnowledgeImport(ctx, claim, response); err != nil {
		logger.CtxWarn(ctx, "could not cache Knowledge import receipt: %v", err)
	}

	return response, nil
}

func (s *Service) validateKnowledgeImport(
	ctx context.Context,
	req *integrationdto.ImportAzureDevOpsKnowledgeRequest,
	actor string,
) error {
	if req == nil || req.Export == nil || !req.ConfirmSnapshot || strings.TrimSpace(req.Name) == "" {
		return apperr.New(errcode.CommonInvalidParam, "export, name, and snapshot confirmation are required")
	}

	requestID, err := uuid.Parse(req.RequestId)
	if err != nil || requestID.Version() != 4 || requestID.String() != req.RequestId {
		return apperr.New(errcode.CommonInvalidParam, "requestId must be a UUID v4")
	}

	if err := s.authorizeKnowledgeImport(ctx, req.Export.SicoProjectId, actor); err != nil {
		return err
	}
	if s == nil || s.Components == nil || s.ProjectService == nil || s.KnowledgeService == nil || s.Cache == nil {
		return apperr.New(errcode.CommonUnavailable, "knowledge import is not available")
	}

	return s.requireScope(ctx, rbac.ScopeProject, req.Export.SicoProjectId, "integration", "use")
}

func (s *Service) authorizeKnowledgeImport(
	ctx context.Context,
	projectID int64,
	actor string,
) error {
	if projectID <= 0 {
		return apperr.New(errcode.CommonInvalidParam, "sicoProjectId must be positive")
	}

	return s.requireScopeOrOwner(ctx, rbac.ProjectScope(projectID), rbac.PermissionAssetManage, actor)
}

func (s *Service) saveAzureDevOpsKnowledge(
	ctx context.Context,
	req *integrationdto.ImportAzureDevOpsKnowledgeRequest,
	actor string,
	export *azuredevops.QueryExport,
) (*integrationdto.ImportAzureDevOpsKnowledgeResponse, error) {
	if err := s.authorizeKnowledgeImport(ctx, req.Export.SicoProjectId, actor); err != nil {
		return nil, err
	}

	asset, err := s.ProjectService.AddProjectAsset(
		ctx,
		&projectdto.AddProjectAssetRequest{
			ProjectId: strconv.FormatInt(req.Export.SicoProjectId, 10),
		},
		actor,
		bytes.NewReader(export.Content),
		project.FileExtraInfo{
			FileName:    export.FileName,
			FileSize:    int64(len(export.Content)),
			FileExt:     export.FileExt,
			FileType:    "document",
			ContentType: export.ContentType,
			SHA256:      fmt.Sprintf("%x", sha256.Sum256(export.Content)),
		},
	)
	if err != nil {
		return nil, err
	}

	if asset.GetData().GetId() <= 0 {
		return nil, errors.New("export asset upload returned no asset ID")
	}

	document, err := s.KnowledgeService.CreateDocument(ctx, &knowledgedto.CreateKnowledgeDocumentRequest{
		ProjectId:    req.Export.SicoProjectId,
		AssetId:      asset.Data.Id,
		DocumentType: knowledgedto.KnowledgeDocumentType_KNOWLEDGE_DOCUMENT_TYPE_FILE,
		Name:         strings.TrimSpace(req.Name),
	})
	if err != nil {
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
		defer cancel()

		_, cleanupErr := s.ProjectService.DeleteProjectAsset(
			cleanupCtx,
			&projectdto.DeleteProjectAssetRequest{Id: asset.Data.Id},
		)
		return nil, errors.Join(err, cleanupErr)
	}

	return appresp.Success(&integrationdto.ImportAzureDevOpsKnowledgeResponse{
		Data: &integrationdto.ImportAzureDevOpsKnowledgeData{
			DocumentId:    strconv.FormatInt(document.GetData().GetId(), 10),
			AssetId:       strconv.FormatInt(asset.Data.Id, 10),
			FileName:      export.FileName,
			WorkItemCount: int32(export.Count),
			QueryId:       export.QueryID,
			QueryAsOf:     export.QueryAsOf,
			ExportedAt:    export.ExportedAt,
			Name:          strings.TrimSpace(req.Name),
			ExportSource:  export.ExportSource,
		},
	}), nil
}
