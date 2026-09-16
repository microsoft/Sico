package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/errcode"
	integrationdto "sico-backend/internal/transport/http/dto/integration"
)

func TestAzureDevOpsPersonalFlowCookieBindsInitiatingBrowser(t *testing.T) {
	gin.SetMode(gin.TestMode)
	state := "personal-oauth-state"
	authorizationURL := "https://login.microsoftonline.test/tenant/oauth2/v2.0/authorize?" + url.Values{
		"state":        {state},
		"redirect_uri": {"https://sico.test" + azureDevOpsPersonalCallbackPath},
	}.Encode()
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/personal/start", nil)

	err := setAzureDevOpsPersonalFlowCookie(ctx, &integrationdto.StartAzureDevOpsAuthorizationResponse{
		Data: &integrationdto.StartAzureDevOpsAuthorizationData{
			AuthorizationUrl: authorizationURL,
			ExpiresAt:        time.Now().Add(10 * time.Minute).UnixMilli(),
		},
	})

	require.NoError(t, err)
	cookies := recorder.Result().Cookies()
	require.Len(t, cookies, 1)
	cookie := cookies[0]
	legacyHash := sha256.Sum256([]byte("/api/sico/integrations/azure-devops/personal/callback\x00" + state))
	assert.Equal(t, "sico_ado_flow_"+hex.EncodeToString(legacyHash[:16]), cookie.Name)
	assert.Equal(t, azureDevOpsPersonalCallbackPath, cookie.Path)
	assert.True(t, cookie.HttpOnly)
	assert.True(t, cookie.Secure)
	assert.Equal(t, http.SameSiteLaxMode, cookie.SameSite)

	callbackRecorder := httptest.NewRecorder()
	callbackCtx, _ := gin.CreateTestContext(callbackRecorder)
	callbackCtx.Request = httptest.NewRequest(http.MethodGet, azureDevOpsPersonalCallbackPath, nil)
	callbackCtx.Request.AddCookie(cookie)
	require.NoError(t, validateAzureDevOpsPersonalFlowCookie(callbackCtx, state))

	clearAzureDevOpsPersonalFlowCookie(callbackCtx, state)
	cleared := callbackRecorder.Result().Cookies()
	require.Len(t, cleared, 1)
	assert.Equal(t, cookie.Name, cleared[0].Name)
	assert.Equal(t, cookie.Path, cleared[0].Path)
	assert.Empty(t, cleared[0].Value)
	assert.Equal(t, -1, cleared[0].MaxAge)
	assert.True(t, cleared[0].HttpOnly)
	assert.Equal(t, http.SameSiteLaxMode, cleared[0].SameSite)
}

func TestAzureDevOpsPersonalFlowCookieRejectsDifferentBrowser(t *testing.T) {
	gin.SetMode(gin.TestMode)
	state := "personal-oauth-state"

	for _, cookieValue := range []string{"", "different-state"} {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodGet, azureDevOpsPersonalCallbackPath, nil)
		if cookieValue != "" {
			ctx.Request.AddCookie(&http.Cookie{
				Name:  azureDevOpsPersonalFlowCookieName(state),
				Value: cookieValue,
			})
		}

		err := validateAzureDevOpsPersonalFlowCookie(ctx, state)

		appError, ok := apperr.As(err)
		require.True(t, ok)
		assert.Equal(t, errcode.IntegrationOAuthStateInvalid, appError.Code())
	}
}
