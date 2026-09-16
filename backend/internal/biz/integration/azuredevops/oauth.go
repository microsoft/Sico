package azuredevops

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"

	"sico-backend/internal/biz/integration/connector"
)

var ErrReauthorizationRequired = errors.New("azure devops reauthorization is required")

const clientAssertionType = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"

type AuthorizationStart = connector.AuthorizationStart
type AuthorizationCompletion = connector.AuthorizationCompletion
type TokenBundle = connector.TokenBundle

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	Scope        string `json:"scope"`
	ExpiresIn    int64  `json:"expires_in"`
	IDToken      string `json:"id_token"`
	Error        string `json:"error"`
	Description  string `json:"error_description"`
}

func (c *Connector) ConsumeAuthorizationState(ctx context.Context, stateID string) (*OAuthState, error) {
	if err := c.requireEnabled(); err != nil {
		return nil, err
	}

	return c.states.Consume(ctx, stateID)
}

func (c *Connector) StartAuthorization(
	ctx context.Context,
	flow, connectionKey string,
	organizationID int64,
	actor string,
) (*AuthorizationStart, error) {
	if err := c.requireEnabled(); err != nil {
		return nil, err
	}
	if err := c.requireFlowEnabled(flow); err != nil {
		return nil, err
	}

	verifier, err := randomURLToken(64)
	if err != nil {
		return nil, err
	}

	expiresAt := time.Now().Add(c.config.StateTTL).UnixMilli()
	operationID := uuid.NewString()
	stateID, err := c.states.Create(ctx, &OAuthState{
		Flow:           flow,
		OperationID:    operationID,
		ConnectionKey:  connectionKey,
		OrganizationID: organizationID,
		Actor:          actor,
		CodeVerifier:   verifier,
		ExpiresAt:      expiresAt,
	})
	if err != nil {
		return nil, err
	}

	challenge := sha256.Sum256([]byte(verifier))
	query := url.Values{
		"client_id":             {c.config.ClientID},
		"response_type":         {"code"},
		"redirect_uri":          {c.config.PersonalRedirectURL},
		"response_mode":         {"query"},
		"scope":                 {c.oauthScopes()},
		"state":                 {stateID},
		"code_challenge":        {base64.RawURLEncoding.EncodeToString(challenge[:])},
		"code_challenge_method": {"S256"},
		"prompt":                {"select_account"},
	}
	authorizationURL := c.oauthEndpoint(c.config.OAuthTenant, "authorize") + "?" + query.Encode()

	return &AuthorizationStart{
		AuthorizationURL: authorizationURL,
		OperationID:      operationID,
		ExpiresAt:        expiresAt,
	}, nil
}

func (c *Connector) CompleteAuthorization(
	ctx context.Context,
	expectedFlow, stateID, code string,
) (*AuthorizationCompletion, error) {
	if err := c.requireEnabled(); err != nil {
		return nil, err
	}
	if err := c.requireFlowEnabled(expectedFlow); err != nil {
		return nil, err
	}

	state, err := c.states.Consume(ctx, stateID)
	if err != nil {
		return nil, err
	}
	if state.Flow != expectedFlow {
		return nil, ErrOAuthStateInvalid
	}

	completion := &AuthorizationCompletion{State: state}
	if strings.TrimSpace(code) == "" {
		return completion, errors.New("authorization code is required")
	}

	requestedScope := c.oauthScopes()
	values := url.Values{
		"client_id":     {c.config.ClientID},
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"redirect_uri":  {c.config.PersonalRedirectURL},
		"code_verifier": {state.CodeVerifier},
		"scope":         {requestedScope},
	}
	if err := c.addClientAuthentication(ctx, values); err != nil {
		return completion, err
	}

	response, err := c.requestToken(ctx, c.config.OAuthTenant, values)
	if err != nil {
		return completion, err
	}

	tenantID := JWTUUIDClaim(response.AccessToken, "tid")
	if tenantID == "" {
		tenantID = JWTUUIDClaim(response.IDToken, "tid")
	}

	bundle := tokenBundle(response, tenantID, requestedScope)
	profile, err := c.GetProfile(ctx, bundle.AccessToken)
	if err != nil {
		return completion, err
	}

	bundle.ProfileID = profile.ID
	completion.Bundle = bundle
	completion.Profile = profile
	completion.TenantID = tenantID

	return completion, nil
}

func (c *Connector) RefreshToken(ctx context.Context, bundle *TokenBundle) (*TokenBundle, bool, error) {
	if bundle.ExpiresAt > time.Now().Add(2*time.Minute).UnixMilli() {
		return bundle, false, nil
	}
	if bundle.RefreshToken == "" {
		return nil, false, ErrReauthorizationRequired
	}

	tenant := bundle.TenantID
	if tenant == "" {
		tenant = c.config.OAuthTenant
	}

	requestedScope := bundle.RequestedScope
	if requestedScope == "" {
		requestedScope = c.oauthScopes()
	}

	values := url.Values{
		"client_id":     {c.config.ClientID},
		"grant_type":    {"refresh_token"},
		"refresh_token": {bundle.RefreshToken},
		"scope":         {requestedScope},
	}
	if err := c.addClientAuthentication(ctx, values); err != nil {
		return nil, false, err
	}

	response, err := c.requestToken(ctx, tenant, values)
	if err != nil {
		return nil, false, err
	}

	refreshed := tokenBundle(response, bundle.TenantID, requestedScope)
	refreshed.ProfileID = bundle.ProfileID
	if refreshed.RefreshToken == "" {
		refreshed.RefreshToken = bundle.RefreshToken
	}

	return refreshed, true, nil
}

func (c *Connector) addClientAuthentication(ctx context.Context, values url.Values) error {
	if c.clientAssertions == nil {
		return errors.New("azure managed identity credential is not configured")
	}

	assertion, err := c.clientAssertions.GetClientAssertion(ctx)
	if err != nil {
		return err
	}
	if strings.TrimSpace(assertion) == "" {
		return errors.New("azure managed identity credential returned an empty client assertion")
	}

	values.Set("client_assertion_type", clientAssertionType)
	values.Set("client_assertion", assertion)

	return nil
}

func (c *Connector) EncryptTokenBundle(
	connectionID, version int64,
	mode int32,
	bundle *TokenBundle,
) (*EncryptedData, error) {
	plaintext, err := json.Marshal(bundle)
	if err != nil {
		return nil, fmt.Errorf("marshal Azure DevOps token bundle: %w", err)
	}

	return c.cipher.Encrypt(plaintext, CredentialAAD(connectionID, version, ProviderKey, mode))
}

func (c *Connector) DecryptTokenBundle(
	connectionID, version int64,
	mode int32,
	encrypted *EncryptedData,
) (*TokenBundle, error) {
	plaintext, err := c.cipher.Decrypt(encrypted, CredentialAAD(connectionID, version, ProviderKey, mode))
	if err != nil {
		return nil, err
	}

	var bundle TokenBundle
	if err := json.Unmarshal(plaintext, &bundle); err != nil ||
		bundle.SchemaVersion != 1 || bundle.AccessToken == "" {
		return nil, ErrDecryptCredential
	}

	return &bundle, nil
}

func (c *Connector) requestToken(
	ctx context.Context,
	tenant string,
	values url.Values,
) (*tokenResponse, error) {
	endpoint := c.oauthEndpoint(tenant, "token")
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(values.Encode()))
	if err != nil {
		return nil, fmt.Errorf("create Entra token request: %w", err)
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	var response tokenResponse
	if err := c.doJSON(request, &response); err != nil {
		if strings.Contains(err.Error(), "invalid_grant") || strings.Contains(err.Error(), "interaction_required") {
			return nil, ErrReauthorizationRequired
		}
		return nil, err
	}

	if response.Error != "" {
		return nil, providerError("Entra token", http.StatusBadRequest, response.Error+": "+response.Description)
	}
	if response.AccessToken == "" {
		return nil, errors.New("entra token response did not contain an access token")
	}
	if values.Get("grant_type") == "authorization_code" && response.RefreshToken == "" {
		return nil, errors.New("entra token response did not contain a refresh token")
	}

	return &response, nil
}

func (c *Connector) oauthScopes() string {
	return "openid profile offline_access " + c.config.PersonalOAuthScopes
}

func (c *Connector) requireFlowEnabled(flow string) error {
	if flow != FlowPersonal {
		return errors.New("unsupported Azure DevOps authorization flow")
	}

	return nil
}

func tokenBundle(
	response *tokenResponse,
	tenantID, requestedScope string,
) *TokenBundle {
	return &TokenBundle{
		SchemaVersion:  1,
		AccessToken:    response.AccessToken,
		RefreshToken:   response.RefreshToken,
		TokenType:      response.TokenType,
		Scope:          response.Scope,
		ExpiresAt:      time.Now().Add(time.Duration(response.ExpiresIn) * time.Second).UnixMilli(),
		TenantID:       tenantID,
		RequestedScope: requestedScope,
	}
}
