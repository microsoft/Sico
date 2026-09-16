package azuredevops

import (
	"context"
	"errors"
	"fmt"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore"
	"github.com/Azure/azure-sdk-for-go/sdk/azcore/policy"
	"github.com/Azure/azure-sdk-for-go/sdk/azidentity"
)

const tokenExchangeScope = "api://AzureADTokenExchange/.default"

type ClientAssertionProvider interface {
	GetClientAssertion(ctx context.Context) (string, error)
}

type azureClientAssertionProvider struct {
	credential azcore.TokenCredential
}

func NewClientAssertionProvider(config Config) (ClientAssertionProvider, error) {
	provider := &azureClientAssertionProvider{}
	if !config.Enabled {
		return provider, nil
	}
	credential, err := azidentity.NewManagedIdentityCredential(&azidentity.ManagedIdentityCredentialOptions{
		ID: azidentity.ClientID(config.AssertionClientID),
	})
	if err != nil {
		return nil, fmt.Errorf("create Azure managed identity credential: %w", err)
	}
	provider.credential = credential
	return provider, nil
}

func (provider *azureClientAssertionProvider) GetClientAssertion(ctx context.Context) (string, error) {
	if provider.credential == nil {
		return "", errors.New("azure managed identity credential is not configured")
	}
	token, err := provider.credential.GetToken(ctx, policy.TokenRequestOptions{Scopes: []string{tokenExchangeScope}})
	if err != nil {
		return "", fmt.Errorf("acquire Azure client assertion: %w", err)
	}
	return token.Token, nil
}
