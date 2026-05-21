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

package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	knowledgebiz "sico-backend/internal/biz/knowledge"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/errcode"
	"sico-backend/internal/transport/http/dto/knowledge"
)

func knowledgeService(ctx *gin.Context) (knowledgebiz.Service, bool) {
	svc := knowledgebiz.Default()
	if svc == nil {
		internalServerErrorResponse(ctx, apperr.New(errcode.CommonUnavailable, "knowledge service not initialized"))
		return nil, false
	}

	return svc, true
}

// CreateDocument .
// @Router /api/sico/knowledge/document [POST]
// @Tags knowledge
// @Accept json
// @Produce json
// @Param request body knowledge.CreateKnowledgeDocumentRequest true "Create Knowledge Document"
// @Success 200 {object} knowledge.CreateKnowledgeDocumentResponse
// @Security BearerAuth
func CreateDocument(ctx *gin.Context) {
	var (
		err error
		req knowledge.CreateKnowledgeDocumentRequest
	)

	if err = ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	svc, ok := knowledgeService(ctx)
	if !ok {
		return
	}

	resp, err := svc.CreateDocument(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// GetDocument .
// @Router /api/sico/knowledge/document [GET]
// @Tags knowledge
// @Produce json
// @Param request query knowledge.GetKnowledgeDocumentRequest true "Get Knowledge Document"
// @Success 200 {object} knowledge.GetKnowledgeDocumentResponse
// @Security BearerAuth
func GetDocument(ctx *gin.Context) {
	var (
		err error
		req knowledge.GetKnowledgeDocumentRequest
	)

	if err = ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	svc, ok := knowledgeService(ctx)
	if !ok {
		return
	}

	resp, err := svc.GetDocument(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// GetDocumentDetails .
// @Router /api/sico/knowledge/document/details [GET]
// @Tags knowledge
// @Produce json
// @Param request query knowledge.GetKnowledgeDocumentDetailsRequest true "Get Knowledge Document Details"
// @Success 200 {object} knowledge.GetKnowledgeDocumentDetailsResponse
// @Security BearerAuth
func GetDocumentDetails(ctx *gin.Context) {
	var (
		err error
		req knowledge.GetKnowledgeDocumentDetailsRequest
	)

	if err = ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	svc, ok := knowledgeService(ctx)
	if !ok {
		return
	}

	resp, err := svc.GetDocumentDetails(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// UpdateDocument .
// @Router /api/sico/knowledge/document [PUT]
// @Tags knowledge
// @Accept json
// @Produce json
// @Param request body knowledge.UpdateKnowledgeDocumentRequest true "Update Knowledge Document"
// @Success 200 {object} knowledge.UpdateKnowledgeDocumentResponse
// @Security BearerAuth
func UpdateDocument(ctx *gin.Context) {
	var (
		err error
		req knowledge.UpdateKnowledgeDocumentRequest
	)

	if err = ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	svc, ok := knowledgeService(ctx)
	if !ok {
		return
	}

	resp, err := svc.UpdateDocument(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// DeleteDocument .
// @Router /api/sico/knowledge/document [DELETE]
// @Tags knowledge
// @Produce json
// @Param request query knowledge.DeleteKnowledgeDocumentRequest true "Delete Knowledge Document"
// @Success 200 {object} knowledge.DeleteKnowledgeDocumentResponse
// @Security BearerAuth
func DeleteDocument(ctx *gin.Context) {
	var (
		err error
		req knowledge.DeleteKnowledgeDocumentRequest
	)

	if err = ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	svc, ok := knowledgeService(ctx)
	if !ok {
		return
	}

	resp, err := svc.DeleteDocument(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// ListDocuments .
// @Router /api/sico/knowledge/documents [GET]
// @Tags knowledge
// @Produce json
// @Param request query knowledge.ListKnowledgeDocumentRequest true "List Knowledge Documents"
// @Success 200 {object} knowledge.ListKnowledgeDocumentResponse
// @Security BearerAuth
func ListDocuments(ctx *gin.Context) {
	var (
		err error
		req knowledge.ListKnowledgeDocumentRequest
	)

	if err = ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	svc, ok := knowledgeService(ctx)
	if !ok {
		return
	}

	resp, err := svc.ListDocuments(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// CreateKnowledgeTag .
// @Router /api/sico/knowledge/tag [POST]
// @Tags knowledge
// @Accept json
// @Produce json
// @Param request body knowledge.CreateKnowledgeTagRequest true "Create Knowledge Tag"
// @Success 200 {object} knowledge.CreateKnowledgeTagResponse
// @Security BearerAuth
func CreateKnowledgeTag(ctx *gin.Context) {
	var (
		err error
		req knowledge.CreateKnowledgeTagRequest
	)

	err = ctx.ShouldBindJSON(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	svc, ok := knowledgeService(ctx)
	if !ok {
		return
	}

	resp, err := svc.CreateKnowledgeTag(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// UpdateKnowledgeTag .
// @Router /api/sico/knowledge/tag [PUT]
// @Tags knowledge
// @Accept json
// @Produce json
// @Param request body knowledge.UpdateKnowledgeTagRequest true "Update Knowledge Tag"
// @Success 200 {object} knowledge.UpdateKnowledgeTagResponse
// @Security BearerAuth
func UpdateKnowledgeTag(ctx *gin.Context) {
	var (
		err error
		req knowledge.UpdateKnowledgeTagRequest
	)

	err = ctx.ShouldBindJSON(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	svc, ok := knowledgeService(ctx)
	if !ok {
		return
	}

	resp, err := svc.UpdateKnowledgeTag(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// DeleteKnowledgeTag .
// @Router /api/sico/knowledge/tag [DELETE]
// @Tags knowledge
// @Produce json
// @Param request query knowledge.DeleteKnowledgeTagRequest true "Delete Knowledge Tag"
// @Success 200 {object} knowledge.DeleteKnowledgeTagResponse
// @Security BearerAuth
func DeleteKnowledgeTag(ctx *gin.Context) {
	var (
		err error
		req knowledge.DeleteKnowledgeTagRequest
	)

	err = ctx.ShouldBindQuery(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	svc, ok := knowledgeService(ctx)
	if !ok {
		return
	}

	resp, err := svc.DeleteKnowledgeTag(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// GetKnowledgeTag .
// @Router /api/sico/knowledge/tag [GET]
// @Tags knowledge
// @Produce json
// @Param request query knowledge.GetKnowledgeTagRequest true "Get Knowledge Tag"
// @Success 200 {object} knowledge.GetKnowledgeTagResponse
// @Security BearerAuth
func GetKnowledgeTag(ctx *gin.Context) {
	var (
		err error
		req knowledge.GetKnowledgeTagRequest
	)

	err = ctx.ShouldBindQuery(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	svc, ok := knowledgeService(ctx)
	if !ok {
		return
	}

	resp, err := svc.GetKnowledgeTag(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// ListKnowledgeTag .
// @Router /api/sico/knowledge/tags [GET]
// @Tags knowledge
// @Produce json
// @Param request query knowledge.ListKnowledgeTagRequest true "List Knowledge Tag"
// @Success 200 {object} knowledge.ListKnowledgeTagResponse
// @Security BearerAuth
func ListKnowledgeTag(ctx *gin.Context) {
	var (
		err error
		req knowledge.ListKnowledgeTagRequest
	)

	err = ctx.ShouldBindQuery(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	svc, ok := knowledgeService(ctx)
	if !ok {
		return
	}

	resp, err := svc.ListKnowledgeTag(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// GetPlaybook .
// @Router /api/sico/knowledge/playbook [GET]
// @Tags knowledge
// @Produce json
// @Param request query knowledge.GetKnowledgePlaybookRequest true "Get Knowledge Playbook"
// @Success 200 {object} knowledge.GetKnowledgePlaybookResponse
// @Security BearerAuth
func GetPlaybook(ctx *gin.Context) {
	var (
		err error
		req knowledge.GetKnowledgePlaybookRequest
	)

	if err = ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	svc, ok := knowledgeService(ctx)
	if !ok {
		return
	}

	resp, err := svc.GetPlaybook(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// ListPlaybooks .
// @Router /api/sico/knowledge/playbooks [GET]
// @Tags knowledge
// @Produce json
// @Param request query knowledge.ListKnowledgePlaybookRequest true "List Knowledge Playbooks"
// @Success 200 {object} knowledge.ListKnowledgePlaybookResponse
// @Security BearerAuth
func ListPlaybooks(ctx *gin.Context) {
	var (
		err error
		req knowledge.ListKnowledgePlaybookRequest
	)

	if err = ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	svc, ok := knowledgeService(ctx)
	if !ok {
		return
	}

	resp, err := svc.ListPlaybooks(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// UpdatePlaybook .
// @Router /api/sico/knowledge/playbook [PUT]
// @Tags knowledge
// @Accept json
// @Produce json
// @Param request body knowledge.UpdateKnowledgePlaybookRequest true "Update Knowledge Playbook"
// @Success 200 {object} knowledge.UpdateKnowledgePlaybookResponse
// @Security BearerAuth
func UpdatePlaybook(ctx *gin.Context) {
	var (
		err error
		req knowledge.UpdateKnowledgePlaybookRequest
	)

	if err = ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	svc, ok := knowledgeService(ctx)
	if !ok {
		return
	}

	resp, err := svc.UpdatePlaybook(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// GetPlaybookDetails .
// @Router /api/sico/knowledge/playbook/details [GET]
// @Tags knowledge
// @Produce json
// @Param request query knowledge.GetKnowledgePlaybookDetailsRequest true "Get Knowledge Playbook Details"
// @Success 200 {object} knowledge.GetKnowledgePlaybookDetailsResponse
// @Security BearerAuth
func GetPlaybookDetails(ctx *gin.Context) {
	var (
		err error
		req knowledge.GetKnowledgePlaybookDetailsRequest
	)

	if err = ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	svc, ok := knowledgeService(ctx)
	if !ok {
		return
	}

	resp, err := svc.GetPlaybookDetails(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}
