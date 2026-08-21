package knowledge

import (
	"context"

	"sico-backend/internal/transport/http/dto/knowledge"
	reverse_rpc "sico-backend/internal/transport/reverse_grpc/pb/knowledge"
)

// Service defines the knowledge application contract consumed by transport handlers.
type Service interface {
	CreateDocument(
		ctx context.Context,
		req *knowledge.CreateKnowledgeDocumentRequest,
	) (*knowledge.CreateKnowledgeDocumentResponse, error)
	GetDocument(
		ctx context.Context,
		req *knowledge.GetKnowledgeDocumentRequest,
	) (*knowledge.GetKnowledgeDocumentResponse, error)
	UpdateDocument(
		ctx context.Context,
		req *knowledge.UpdateKnowledgeDocumentRequest,
	) (*knowledge.UpdateKnowledgeDocumentResponse, error)
	DeleteDocument(
		ctx context.Context,
		req *knowledge.DeleteKnowledgeDocumentRequest,
	) (*knowledge.DeleteKnowledgeDocumentResponse, error)
	ListDocuments(
		ctx context.Context,
		req *knowledge.ListKnowledgeDocumentRequest,
	) (*knowledge.ListKnowledgeDocumentResponse, error)
	GetDocumentDetails(
		ctx context.Context,
		req *knowledge.GetKnowledgeDocumentDetailsRequest,
	) (*knowledge.GetKnowledgeDocumentDetailsResponse, error)
	CreateKnowledgeTag(
		ctx context.Context,
		req *knowledge.CreateKnowledgeTagRequest,
	) (*knowledge.CreateKnowledgeTagResponse, error)
	UpdateKnowledgeTag(
		ctx context.Context,
		req *knowledge.UpdateKnowledgeTagRequest,
	) (*knowledge.UpdateKnowledgeTagResponse, error)
	DeleteKnowledgeTag(
		ctx context.Context,
		req *knowledge.DeleteKnowledgeTagRequest,
	) (*knowledge.DeleteKnowledgeTagResponse, error)
	GetKnowledgeTag(
		ctx context.Context,
		req *knowledge.GetKnowledgeTagRequest,
	) (*knowledge.GetKnowledgeTagResponse, error)
	ListKnowledgeTag(
		ctx context.Context,
		req *knowledge.ListKnowledgeTagRequest,
	) (*knowledge.ListKnowledgeTagResponse, error)
	GetPlaybook(
		ctx context.Context,
		req *knowledge.GetKnowledgePlaybookRequest,
	) (*knowledge.GetKnowledgePlaybookResponse, error)
	ListPlaybooks(
		ctx context.Context,
		req *knowledge.ListKnowledgePlaybookRequest,
	) (*knowledge.ListKnowledgePlaybookResponse, error)
	ListKnowledgeItems(
		ctx context.Context,
		req *knowledge.ListKnowledgeItemsRequest,
	) (*knowledge.ListKnowledgeItemsResponse, error)
	UpdatePlaybook(
		ctx context.Context,
		req *knowledge.UpdateKnowledgePlaybookRequest,
	) (*knowledge.UpdateKnowledgePlaybookResponse, error)
	DeletePlaybook(
		ctx context.Context,
		req *knowledge.DeleteKnowledgePlaybookRequest,
	) (*knowledge.DeleteKnowledgePlaybookResponse, error)
	GetPlaybookDetails(
		ctx context.Context,
		req *knowledge.GetKnowledgePlaybookDetailsRequest,
	) (*knowledge.GetKnowledgePlaybookDetailsResponse, error)

	reverse_rpc.ReverseKnowledgeRPCServer
}

var defaultSvc Service

// Default returns the singleton knowledge application service.
func Default() Service {
	return defaultSvc
}

func setDefault(svc Service) {
	defaultSvc = svc
}
