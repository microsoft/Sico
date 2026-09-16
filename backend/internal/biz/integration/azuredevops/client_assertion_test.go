package azuredevops

import (
	"context"
	"errors"
	"testing"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore"
	"github.com/Azure/azure-sdk-for-go/sdk/azcore/policy"
	"github.com/Azure/azure-sdk-for-go/sdk/azidentity"
	"github.com/stretchr/testify/require"
)

func TestClientAssertionProviderUsesManagedIdentity(t *testing.T) {
	provider, err := NewClientAssertionProvider(Config{
		Enabled: true, AssertionClientID: "33333333-3333-3333-3333-333333333333",
	})

	require.NoError(t, err)
	require.IsType(t, &azidentity.ManagedIdentityCredential{}, provider.(*azureClientAssertionProvider).credential)
}

func TestClientAssertionRequestsTokenExchangeAudience(t *testing.T) {
	credential := &fakeManagedIdentityCredential{token: "managed-identity-assertion"}
	provider := &azureClientAssertionProvider{credential: credential}

	assertion, err := provider.GetClientAssertion(context.Background())

	require.NoError(t, err)
	require.Equal(t, "managed-identity-assertion", assertion)
	require.Equal(t, []string{"api://AzureADTokenExchange/.default"}, credential.scopes)
}

func TestClientAssertionPropagatesManagedIdentityFailure(t *testing.T) {
	failure := errors.New("managed identity unavailable")
	provider := &azureClientAssertionProvider{credential: &fakeManagedIdentityCredential{err: failure}}

	assertion, err := provider.GetClientAssertion(context.Background())

	require.ErrorIs(t, err, failure)
	require.Empty(t, assertion)
}

type fakeManagedIdentityCredential struct {
	token  string
	scopes []string
	err    error
}

func (credential *fakeManagedIdentityCredential) GetToken(
	_ context.Context,
	options policy.TokenRequestOptions,
) (azcore.AccessToken, error) {
	credential.scopes = options.Scopes
	return azcore.AccessToken{Token: credential.token}, credential.err
}
