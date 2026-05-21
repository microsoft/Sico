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
	UpdatePlaybook(
		ctx context.Context,
		req *knowledge.UpdateKnowledgePlaybookRequest,
	) (*knowledge.UpdateKnowledgePlaybookResponse, error)
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
