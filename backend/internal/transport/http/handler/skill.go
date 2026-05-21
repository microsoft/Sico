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

	skillbiz "sico-backend/internal/biz/skill"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/errcode"
	"sico-backend/internal/transport/http/dto/skill"
)

func skillService(ctx *gin.Context) (skillbiz.Service, bool) {
	svc := skillbiz.Default()
	if svc == nil {
		internalServerErrorResponse(ctx, apperr.New(errcode.CommonUnavailable, "skill service not initialized"))
		return nil, false
	}

	return svc, true
}

// CreateSkill .
// @Router /api/sico/skills [POST]
// @Tags skills
// @Accept json
// @Produce json
// @Param request body skill.CreateSkillRequest true "Create Skill"
// @Success 200 {object} skill.CreateSkillResponse
// @Security BearerAuth
func CreateSkill(ctx *gin.Context) {
	var req skill.CreateSkillRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	svc, ok := skillService(ctx)
	if !ok {
		return
	}

	resp, err := svc.CreateSkill(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// GetSkill .
// @Router /api/sico/skills [GET]
// @Tags skills
// @Produce json
// @Param request query skill.GetSkillRequest true "Get Skill"
// @Success 200 {object} skill.GetSkillResponse
// @Security BearerAuth
func GetSkill(ctx *gin.Context) {
	var req skill.GetSkillRequest
	if err := ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	svc, ok := skillService(ctx)
	if !ok {
		return
	}

	resp, err := svc.GetSkill(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// UpdateSkill .
// @Router /api/sico/skills [PUT]
// @Tags skills
// @Accept json
// @Produce json
// @Param request body skill.UpdateSkillRequest true "Update Skill"
// @Success 200 {object} skill.UpdateSkillResponse
// @Security BearerAuth
func UpdateSkill(ctx *gin.Context) {
	var req skill.UpdateSkillRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	svc, ok := skillService(ctx)
	if !ok {
		return
	}

	resp, err := svc.UpdateSkill(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// DeleteSkill .
// @Router /api/sico/skills [DELETE]
// @Tags skills
// @Produce json
// @Param request query skill.DeleteSkillRequest true "Delete Skill"
// @Success 200 {object} skill.DeleteSkillResponse
// @Security BearerAuth
func DeleteSkill(ctx *gin.Context) {
	var req skill.DeleteSkillRequest
	if err := ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	svc, ok := skillService(ctx)
	if !ok {
		return
	}

	resp, err := svc.DeleteSkill(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// ListSkills .
// @Router /api/sico/skills/list [GET]
// @Tags skills
// @Produce json
// @Param request query skill.ListSkillRequest true "List Skills"
// @Success 200 {object} skill.ListSkillResponse
// @Security BearerAuth
func ListSkills(ctx *gin.Context) {
	var req skill.ListSkillRequest
	if err := ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	svc, ok := skillService(ctx)
	if !ok {
		return
	}

	resp, err := svc.ListSkills(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// GetSkillDetails .
// @Router /api/sico/skills/details [GET]
// @Tags skills
// @Produce json
// @Param request query skill.GetSkillDetailsRequest true "Get Skill Details"
// @Success 200 {object} skill.GetSkillDetailsResponse
// @Security BearerAuth
func GetSkillDetails(ctx *gin.Context) {
	var req skill.GetSkillDetailsRequest
	if err := ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	svc, ok := skillService(ctx)
	if !ok {
		return
	}

	resp, err := svc.GetSkillDetails(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}
