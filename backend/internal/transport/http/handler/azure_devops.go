package handler

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	integrationsvc "sico-backend/internal/biz/integration"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/errcode"
	integrationdto "sico-backend/internal/transport/http/dto/integration"
)

const azureDevOpsPersonalCallbackPath = "/api/sico/integrations/azure-devops/personal/callback"

// StartAzureDevOpsPersonal starts personal delegated authorization.
// @Router /api/sico/integrations/azure-devops/personal/start [post]
// @Tags Azure DevOps Integration
// @Accept json
// @Produce json
// @Param request body integrationdto.StartAzureDevOpsAuthorizationRequest true "Authorization request"
// @Success 200 {object} integrationdto.StartAzureDevOpsAuthorizationResponse
// @Security BearerAuth
func StartAzureDevOpsPersonal(ctx *gin.Context) {
	actor, ok := integrationActor(ctx)
	if !ok {
		return
	}

	var req integrationdto.StartAzureDevOpsAuthorizationRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	response, err := integrationsvc.Default().StartAzureDevOpsPersonal(reqctx(ctx), &req, actor)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	if err := setAzureDevOpsPersonalFlowCookie(ctx, response); err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, response)
}

// ListAzureDevOpsConnections lists Azure DevOps connections visible to the caller.
// @Router /api/sico/integrations/azure-devops/connections [get]
// @Tags Azure DevOps Integration
// @Produce json
// @Param request query integrationdto.ListConnectionsRequest true "Connection filters"
// @Success 200 {object} integrationdto.ListConnectionsResponse
// @Security BearerAuth
func ListAzureDevOpsConnections(ctx *gin.Context) {
	actor, ok := integrationActor(ctx)
	if !ok {
		return
	}

	var req integrationdto.ListConnectionsRequest
	if err := ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	response, err := integrationsvc.Default().ListAzureDevOpsConnections(reqctx(ctx), &req, actor)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, response)
}

// ListAzureDevOpsCandidates lists organizations, or projects within the selected organization.
// @Router /api/sico/integrations/azure-devops/candidates [get]
// @Tags Azure DevOps Integration
// @Produce json
// @Param request query integrationdto.ListAzureDevOpsCandidatesRequest true "Candidate request"
// @Success 200 {object} integrationdto.ListAzureDevOpsCandidatesResponse
// @Security BearerAuth
func ListAzureDevOpsCandidates(ctx *gin.Context) {
	actor, ok := integrationActor(ctx)
	if !ok {
		return
	}

	var req integrationdto.ListAzureDevOpsCandidatesRequest
	if err := ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	response, err := integrationsvc.Default().ListAzureDevOpsCandidates(reqctx(ctx), &req, actor)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, response)
}

// ListAzureDevOpsProjectConnections lists project accounts without contacting Azure DevOps.
// @Router /api/sico/integrations/azure-devops/project-connections [get]
// @Tags Azure DevOps Integration
// @Produce json
// @Param request query integrationdto.ListAzureDevOpsProjectConnectionsRequest true "Project connection filters"
// @Success 200 {object} integrationdto.ListAzureDevOpsProjectConnectionsResponse
// @Security BearerAuth
func ListAzureDevOpsProjectConnections(ctx *gin.Context) {
	actor, ok := integrationActor(ctx)
	if !ok {
		return
	}

	var req integrationdto.ListAzureDevOpsProjectConnectionsRequest
	if err := ctx.ShouldBindQuery(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	response, err := integrationsvc.Default().ListAzureDevOpsProjectConnections(reqctx(ctx), &req, actor)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, response)
}

// QueryAzureDevOpsContent reads a verified ADO project using a connection owned by the caller's Sico project.
// @Router /api/sico/integrations/azure-devops/content/query [post]
// @Tags Azure DevOps Integration
// @Accept json
// @Produce json
// @Param request body integrationdto.QueryAzureDevOpsContentRequest true "Structured content query"
// @Success 200 {object} integrationdto.QueryAzureDevOpsContentResponse
// @Security BearerAuth
func QueryAzureDevOpsContent(ctx *gin.Context) {
	actor, ok := integrationActor(ctx)
	if !ok {
		return
	}

	var req integrationdto.QueryAzureDevOpsContentRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	response, err := integrationsvc.Default().QueryAzureDevOpsContent(reqctx(ctx), &req, actor)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, response)
}

// AzureDevOpsPersonalCallback completes personal delegated authorization.
// @Router /api/sico/integrations/azure-devops/personal/callback [get]
// @Tags Azure DevOps Integration
// @Param state query string true "One-time OAuth state"
// @Param code query string false "Authorization code"
// @Param error query string false "Provider error code"
// @Success 302 {string} string "Redirect to the configured frontend return URL"
func AzureDevOpsPersonalCallback(ctx *gin.Context) {
	state := strings.TrimSpace(ctx.Query("state"))
	if state == "" {
		invalidParamRequestResponse(ctx, "state is required")
		return
	}
	if err := validateAzureDevOpsPersonalFlowCookie(ctx, state); err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}
	defer clearAzureDevOpsPersonalFlowCookie(ctx, state)

	var redirectURL string
	var err error
	if errorCode := strings.TrimSpace(ctx.Query("error")); errorCode != "" {
		redirectURL, err = integrationsvc.Default().FailAzureDevOpsAuthorization(
			reqctx(ctx), state, errorCode,
		)
	} else {
		redirectURL, err = integrationsvc.Default().CompleteAzureDevOpsPersonal(
			reqctx(ctx), state, strings.TrimSpace(ctx.Query("code")),
		)
	}
	if err != nil && redirectURL == "" {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.Redirect(http.StatusFound, redirectURL)
}

func setAzureDevOpsPersonalFlowCookie(
	ctx *gin.Context,
	response *integrationdto.StartAzureDevOpsAuthorizationResponse,
) error {
	if response == nil || response.Data == nil {
		return errors.New("azure DevOps authorization response is incomplete")
	}

	authorizationURL, err := url.Parse(response.Data.AuthorizationUrl)
	if err != nil {
		return errors.New("azure DevOps authorization URL is invalid")
	}

	state := authorizationURL.Query().Get("state")
	redirectURL, err := url.Parse(authorizationURL.Query().Get("redirect_uri"))
	if err != nil || state == "" || redirectURL.Path != azureDevOpsPersonalCallbackPath {
		return errors.New("azure DevOps authorization URL is incomplete")
	}

	expiresAt := time.UnixMilli(response.Data.ExpiresAt)
	maxAge := int(time.Until(expiresAt).Seconds())
	if maxAge < 1 {
		return errors.New("azure DevOps authorization flow is already expired")
	}

	http.SetCookie(ctx.Writer, &http.Cookie{
		Name:     azureDevOpsPersonalFlowCookieName(state),
		Value:    state,
		Path:     azureDevOpsPersonalCallbackPath,
		Expires:  expiresAt,
		MaxAge:   maxAge,
		Secure:   strings.EqualFold(redirectURL.Scheme, "https"),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})

	return nil
}

func validateAzureDevOpsPersonalFlowCookie(ctx *gin.Context, state string) error {
	cookie, err := ctx.Request.Cookie(azureDevOpsPersonalFlowCookieName(state))
	if err != nil || len(cookie.Value) != len(state) ||
		subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(state)) != 1 {
		return apperr.New(
			errcode.IntegrationOAuthStateInvalid,
			"OAuth flow cookie is missing or invalid",
		)
	}

	return nil
}

func clearAzureDevOpsPersonalFlowCookie(ctx *gin.Context, state string) {
	http.SetCookie(ctx.Writer, &http.Cookie{
		Name:     azureDevOpsPersonalFlowCookieName(state),
		Path:     azureDevOpsPersonalCallbackPath,
		MaxAge:   -1,
		Expires:  time.Unix(1, 0),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func azureDevOpsPersonalFlowCookieName(state string) string {
	hash := sha256.Sum256([]byte(azureDevOpsPersonalCallbackPath + "\x00" + state))

	return "sico_ado_flow_" + hex.EncodeToString(hash[:16])
}
