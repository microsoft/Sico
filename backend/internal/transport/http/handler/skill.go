package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	singleAgentSVC "sico-backend/internal/biz/agent"
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

	// When listing an agent's skills, enforce agent visibility.
	if req.AgentId != "" {
		if err := singleAgentSVC.DefaultFull().CheckAgentVisibility(reqctx(ctx), req.AgentId); err != nil {
			internalServerErrorResponse(ctx, err)
			return
		}
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
