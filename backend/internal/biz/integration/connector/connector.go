package connector

import "context"

type Connector interface {
	Key() string
	Enabled() bool
	FrontendReturnURL() string

	StartAuthorization(
		ctx context.Context,
		flow, connectionKey string,
		organizationID int64,
		actor string,
	) (*AuthorizationStart, error)

	CompleteAuthorization(
		ctx context.Context,
		expectedFlow, stateID, code string,
	) (*AuthorizationCompletion, error)

	ConsumeAuthorizationState(ctx context.Context, stateID string) (*OAuthState, error)
	RefreshToken(ctx context.Context, bundle *TokenBundle) (*TokenBundle, bool, error)

	EncryptTokenBundle(
		connectionID, version int64,
		mode int32,
		bundle *TokenBundle,
	) (*EncryptedData, error)

	DecryptTokenBundle(
		connectionID, version int64,
		mode int32,
		encrypted *EncryptedData,
	) (*TokenBundle, error)
}

type AuthorizationStart struct {
	AuthorizationURL string
	OperationID      string
	ExpiresAt        int64
}

type AuthorizationCompletion struct {
	State    *OAuthState
	Bundle   *TokenBundle
	Profile  *Profile
	TenantID string
}

type OAuthState struct {
	Flow           string `json:"flow"`
	ConnectionKey  string `json:"connectionKey"`
	OrganizationID int64  `json:"organizationId"`
	Actor          string `json:"actor"`
	OperationID    string `json:"operationId"`
	CodeVerifier   string `json:"codeVerifier"`
	CreatedAt      int64  `json:"createdAt"`
	ExpiresAt      int64  `json:"expiresAt"`
}

type TokenBundle struct {
	SchemaVersion  int    `json:"schemaVersion"`
	AccessToken    string `json:"accessToken"`
	RefreshToken   string `json:"refreshToken"`
	TokenType      string `json:"tokenType"`
	Scope          string `json:"scope"`
	ExpiresAt      int64  `json:"expiresAt"`
	TenantID       string `json:"tenantId"`
	ProfileID      string `json:"profileId"`
	RequestedScope string `json:"requestedScope"`
}

type Profile struct {
	ID           string `json:"id"`
	DisplayName  string `json:"displayName"`
	EmailAddress string `json:"emailAddress"`
}

type EncryptedData struct {
	Scheme string
	KeyID  string
	Data   []byte
}
