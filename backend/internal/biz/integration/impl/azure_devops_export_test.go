package impl

import (
	"context"
	"errors"
	"io"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/casbin/casbin/v2"
	casbinmodel "github.com/casbin/casbin/v2/model"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"sico-backend/internal/biz/integration/azuredevops"
	"sico-backend/internal/biz/knowledge"
	"sico-backend/internal/biz/project"
	"sico-backend/internal/biz/rbac"
	"sico-backend/internal/shared/errcode"
	integrationdto "sico-backend/internal/transport/http/dto/integration"
	knowledgedto "sico-backend/internal/transport/http/dto/knowledge"
	projectdto "sico-backend/internal/transport/http/dto/project"
	"sico-backend/internal/transport/http/middleware"
)

type exportProjectService struct {
	project.Service
	content []byte
	request *projectdto.AddProjectAssetRequest
	extra   project.FileExtraInfo
	deleted int64
}

func (service *exportProjectService) AddProjectAsset(
	_ context.Context,
	req *projectdto.AddProjectAssetRequest,
	_ string,
	reader io.Reader,
	extra project.FileExtraInfo,
) (*projectdto.AddProjectAssetResponse, error) {
	service.request, service.extra = req, extra
	content, err := io.ReadAll(reader)
	service.content = content
	return &projectdto.AddProjectAssetResponse{Data: &projectdto.AddProjectAssetData{Id: 7}}, err
}

func (service *exportProjectService) DeleteProjectAsset(
	_ context.Context,
	req *projectdto.DeleteProjectAssetRequest,
) (*projectdto.DeleteProjectAssetResponse, error) {
	service.deleted = req.Id
	return &projectdto.DeleteProjectAssetResponse{}, nil
}

type exportKnowledgeService struct {
	knowledge.Service
	request *knowledgedto.CreateKnowledgeDocumentRequest
	err     error
}

func (service *exportKnowledgeService) CreateDocument(
	_ context.Context,
	req *knowledgedto.CreateKnowledgeDocumentRequest,
) (*knowledgedto.CreateKnowledgeDocumentResponse, error) {
	service.request = req
	return &knowledgedto.CreateKnowledgeDocumentResponse{Data: &knowledgedto.CreateKnowledgeDocumentData{Id: 9}}, service.err
}

func TestSaveAzureDevOpsKnowledgeUsesXLSXAndCurrentProject(t *testing.T) {
	for _, failure := range []bool{false, true} {
		assets, documents := &exportProjectService{}, &exportKnowledgeService{}
		if failure {
			documents.err = errors.New("document creation failed")
		}
		service := NewService(&Components{Access: allowTestAccess{}, ProjectService: assets, KnowledgeService: documents})
		req := &integrationdto.ImportAzureDevOpsKnowledgeRequest{
			Export: &integrationdto.ExportAzureDevOpsQueryRequest{SicoProjectId: 100},
			Name:   "Ready snapshot", ConfirmSnapshot: true,
		}
		export := &azuredevops.QueryExport{
			Content:      []byte("XLSX fixture"),
			FileName:     "ado-query.xlsx",
			Count:        1,
			QueryID:      "query-id",
			FileExt:      "xlsx",
			ContentType:  azuredevops.XLSXContentType,
			ExportSource: azuredevops.ExportSourceWorkItems,
		}
		response, err := service.saveAzureDevOpsKnowledge(context.Background(), req, "alice", export)
		assert.Equal(t, "100", assets.request.ProjectId)
		assert.Equal(t, "xlsx", assets.extra.FileExt)
		assert.Equal(t, azuredevops.XLSXContentType, assets.extra.ContentType)
		assert.Equal(t, export.Content, assets.content)
		assert.Equal(t, int64(100), documents.request.ProjectId)
		assert.Equal(t, int64(7), documents.request.AssetId)
		assert.Equal(t, knowledgedto.KnowledgeDocumentType_KNOWLEDGE_DOCUMENT_TYPE_FILE, documents.request.DocumentType)
		if failure {
			require.Error(t, err)
			assert.Equal(t, int64(7), assets.deleted)
		} else {
			require.NoError(t, err)
			assert.Equal(t, "9", response.Data.DocumentId)
			assert.Zero(t, assets.deleted)
		}
	}
}

func TestImportAzureDevOpsKnowledgeRequiresConfirmationAndWritePermission(t *testing.T) {
	model, err := casbinmodel.NewModelFromString(`
[request_definition]
r = sub, dom, obj, act
[policy_definition]
p = sub, dom, obj, act
[policy_effect]
e = some(where (p.eft == allow))
[matchers]
m = r.sub == p.sub && r.dom == p.dom && r.obj == p.obj && r.act == p.act
`)
	require.NoError(t, err)
	enforcer, err := casbin.NewEnforcer(model)
	require.NoError(t, err)
	_, err = enforcer.AddPolicy("reader", "project:100", "integration", "use")
	require.NoError(t, err)
	miniRedis := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: miniRedis.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	access := rbac.NewAccessServices(nil, nil, enforcer, nil)
	ctx := context.WithValue(context.Background(), middleware.ContextUserKey, middleware.UserInfo{Name: "reader"})
	service := NewService(&Components{Access: access})
	req := &integrationdto.ImportAzureDevOpsKnowledgeRequest{
		Export: &integrationdto.ExportAzureDevOpsQueryRequest{SicoProjectId: 100}, Name: "Snapshot",
		RequestId: "11111111-1111-4111-8111-111111111111",
	}
	_, err = service.ImportAzureDevOpsKnowledge(ctx, req, "reader")
	requireAppErrorCode(t, err, errcode.CommonInvalidParam)
	req.ConfirmSnapshot = true
	_, err = service.ImportAzureDevOpsKnowledge(ctx, req, "reader")
	requireAppErrorCode(t, err, errcode.CommonForbidden)
}

func TestKnowledgeImportRequestDeduplicatesAndIsolatesActors(t *testing.T) {
	miniRedis := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: miniRedis.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	service := NewService(&Components{Access: allowTestAccess{}, Cache: client})
	req := &integrationdto.ImportAzureDevOpsKnowledgeRequest{
		Export: &integrationdto.ExportAzureDevOpsQueryRequest{SicoProjectId: 100},
		Name:   "Snapshot", RequestId: "11111111-1111-4111-8111-111111111111", ConfirmSnapshot: true,
	}
	ctx := context.Background()
	claim, cached, err := service.claimKnowledgeImport(ctx, req, "alice")
	require.NoError(t, err)
	assert.Nil(t, cached)
	_, _, err = service.claimKnowledgeImport(ctx, req, "alice")
	requireAppErrorCode(t, err, errcode.CommonConflict)
	require.NoError(t, service.completeKnowledgeImport(ctx, claim, &integrationdto.ImportAzureDevOpsKnowledgeResponse{
		Data: &integrationdto.ImportAzureDevOpsKnowledgeData{
			DocumentId: "9223372036854775806", AssetId: "9223372036854775805",
		},
	}))
	_, cached, err = service.claimKnowledgeImport(ctx, req, "alice")
	require.NoError(t, err)
	assert.Equal(t, "9223372036854775806", cached.Data.DocumentId)
	_, cached, err = service.claimKnowledgeImport(ctx, req, "bob")
	require.NoError(t, err)
	assert.Nil(t, cached)
	req.Name = "Different snapshot"
	_, _, err = service.claimKnowledgeImport(ctx, req, "alice")
	requireAppErrorCode(t, err, errcode.CommonConflict)
	assert.Equal(t, knowledgeImportRequestTTL, miniRedis.TTL(claim.Key))
}

func TestKnowledgeFileMetadataUsesXLSXAndWorkItemsSource(t *testing.T) {
	assets, documents := &exportProjectService{}, &exportKnowledgeService{}
	service := NewService(&Components{
		Access:           allowTestAccess{},
		ProjectService:   assets,
		KnowledgeService: documents,
	})
	export := &azuredevops.QueryExport{
		Content:      []byte("XLSX fixture"),
		FileName:     "ado-query-fixture.xlsx",
		FileExt:      "xlsx",
		ContentType:  azuredevops.XLSXContentType,
		ExportSource: azuredevops.ExportSourceWorkItems,
		Count:        7,
		QueryID:      "fixture-query",
		QueryAsOf:    "2026-09-07T00:00:00Z",
		ExportedAt:   "2026-09-07T01:00:00Z",
	}
	req := &integrationdto.ImportAzureDevOpsKnowledgeRequest{
		Export:          &integrationdto.ExportAzureDevOpsQueryRequest{SicoProjectId: 100},
		Name:            "Snapshot",
		ConfirmSnapshot: true,
	}

	response, err := service.saveAzureDevOpsKnowledge(context.Background(), req, "actor", export)

	require.NoError(t, err)
	assert.Equal(t, "xlsx", assets.extra.FileExt)
	assert.Equal(t, azuredevops.XLSXContentType, assets.extra.ContentType)
	assert.Equal(t, export.FileName, assets.extra.FileName)
	assert.Equal(t, int64(len(export.Content)), assets.extra.FileSize)
	assert.Equal(t, export.Content, assets.content)
	assert.Equal(t, azuredevops.ExportSourceWorkItems, response.Data.ExportSource)
	assert.Equal(t, int32(7), response.Data.WorkItemCount)
	assert.Equal(t, export.QueryAsOf, response.Data.QueryAsOf)
	assert.Equal(t, export.FileName, response.Data.FileName)
}

func TestKnowledgeImportDeduplicationBindsQueryAndColumns(t *testing.T) {
	miniRedis := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: miniRedis.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	service := NewService(&Components{Access: allowTestAccess{}, Cache: client})
	req := &integrationdto.ImportAzureDevOpsKnowledgeRequest{
		Export: &integrationdto.ExportAzureDevOpsQueryRequest{
			SicoProjectId: 100,
			QueryId:       "query-id",
			ColumnOptions: []string{"System.Id", "System.WorkItemType", "System.Title", "Microsoft.VSTS.TCM.Steps"},
		},
		Name: "Snapshot", RequestId: "11111111-1111-4111-8111-111111111111", ConfirmSnapshot: true,
	}
	ctx := context.Background()
	claim, _, err := service.claimKnowledgeImport(ctx, req, "actor")
	require.NoError(t, err)
	require.NoError(t, service.completeKnowledgeImport(ctx, claim, &integrationdto.ImportAzureDevOpsKnowledgeResponse{
		Data: &integrationdto.ImportAzureDevOpsKnowledgeData{DocumentId: "9", ExportSource: "work_items"},
	}))
	req.Export.ColumnOptions[3] = "System.Description"
	_, _, err = service.claimKnowledgeImport(ctx, req, "actor")
	requireAppErrorCode(t, err, errcode.CommonConflict)
	req.Export.ColumnOptions[3] = "Microsoft.VSTS.TCM.Steps"
	req.Export.QueryId = "other-query"
	_, _, err = service.claimKnowledgeImport(ctx, req, "actor")
	requireAppErrorCode(t, err, errcode.CommonConflict)
	req.Export.QueryId = "query-id"
	_, cached, err := service.claimKnowledgeImport(ctx, req, "actor")
	require.NoError(t, err)
	require.NotNil(t, cached)
	assert.Equal(t, "9", cached.Data.DocumentId)
	assert.Equal(t, "work_items", cached.Data.ExportSource)
}
