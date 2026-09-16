package azuredevops

import (
	"encoding/base64"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestConfigDisabledDoesNotRequireCredentials(t *testing.T) {
	t.Setenv("SICO_ENCRYPTION_KEY", "")
	for _, enabled := range []string{"", "false"} {
		t.Run("enabled="+enabled, func(t *testing.T) {
			t.Setenv("AZURE_DEVOPS_ENABLED", enabled)
			for _, name := range []string{
				"AZURE_DEVOPS_CLIENT_ID", "AZURE_DEVOPS_HOME_TENANT_ID", "AZURE_CLIENT_ID",
				"AZURE_DEVOPS_PERSONAL_REDIRECT_URL", "AZURE_DEVOPS_FRONTEND_RETURN_URL",
				"SICO_ENCRYPTION_KEY",
			} {
				t.Setenv(name, "")
			}

			config, err := ConfigFromEnvironment()

			require.NoError(t, err)
			assert.False(t, config.Enabled)

			connector, err := NewConnector(nil)
			require.NoError(t, err)
			assert.False(t, connector.Enabled())
		})
	}
}

func TestConfigEnabledFailsWithoutClientConfiguration(t *testing.T) {
	t.Setenv("AZURE_DEVOPS_ENABLED", "true")
	t.Setenv("AZURE_DEVOPS_CLIENT_ID", "")

	_, err := ConfigFromEnvironment()

	require.Error(t, err)
	assert.Contains(t, err.Error(), "AZURE_DEVOPS_CLIENT_ID")
}

func TestConfigEnabledUsesManagedIdentityAndDefaultPermissions(t *testing.T) {
	t.Setenv("SICO_ENCRYPTION_KEY", "")
	t.Setenv("AZURE_DEVOPS_ENABLED", "true")
	t.Setenv("AZURE_DEVOPS_CLIENT_ID", "11111111-1111-1111-1111-111111111111")
	t.Setenv("AZURE_CLIENT_ID", "33333333-3333-3333-3333-333333333333")
	t.Setenv("AZURE_DEVOPS_PERSONAL_REDIRECT_URL", "https://test.example/personal/callback")
	t.Setenv("AZURE_DEVOPS_FRONTEND_RETURN_URL", "https://test.example/lab")
	t.Setenv("AZURE_DEVOPS_HOME_TENANT_ID", "22222222-2222-2222-2222-222222222222")
	t.Setenv(
		"SICO_ENCRYPTION_KEY",
		base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef")),
	)

	config, err := ConfigFromEnvironment()

	require.NoError(t, err)
	assert.True(t, config.Enabled)
	assert.Equal(t, "11111111-1111-1111-1111-111111111111", config.ClientID)
	assert.Equal(t, "33333333-3333-3333-3333-333333333333", config.AssertionClientID)
	assert.Equal(t, config.HomeTenantID, config.OAuthTenant)
	assert.Equal(t, azureDevOpsResourceScope, config.PersonalOAuthScopes)

	redisClient := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1"})
	t.Cleanup(func() { _ = redisClient.Close() })
	connector, err := NewConnector(redisClient)
	require.NoError(t, err)
	encrypted, err := connector.EncryptTokenBundle(1, 1, 1, &TokenBundle{
		SchemaVersion: 1, AccessToken: "access-token",
	})
	require.NoError(t, err)
	assert.Equal(t, "integration-key-v1", encrypted.KeyID)
}

func TestConfigUsesFixedProviderDefaults(t *testing.T) {
	t.Setenv("AZURE_DEVOPS_ENABLED", "false")
	t.Setenv("AZURE_DEVOPS_HOME_TENANT_ID", "22222222-2222-2222-2222-222222222222")
	for name, value := range map[string]string{
		"AZURE_DEVOPS_OAUTH_TENANT":      "organizations",
		"AZURE_DEVOPS_PERSONAL_SCOPES":   "vso.profile",
		"AZURE_DEVOPS_AUTHORITY_URL":     "https://override.invalid",
		"AZURE_DEVOPS_PROFILE_BASE_URL":  "https://override.invalid",
		"AZURE_DEVOPS_ACCOUNTS_BASE_URL": "https://override.invalid",
		"AZURE_DEVOPS_API_BASE_URL":      "https://override.invalid",
		"AZURE_DEVOPS_STATE_TTL":         "1m",
		"AZURE_DEVOPS_HTTP_TIMEOUT":      "5s",
	} {
		t.Setenv(name, value)
	}

	config, err := ConfigFromEnvironment()

	require.NoError(t, err)
	assert.Equal(t, config.HomeTenantID, config.OAuthTenant)
	assert.Equal(t, azureDevOpsResourceScope, config.PersonalOAuthScopes)
	assert.Equal(t, "https://login.microsoftonline.com", config.AuthorityURL)
	assert.Equal(t, "https://app.vssps.visualstudio.com", config.ProfileBaseURL)
	assert.Equal(t, "https://app.vssps.visualstudio.com", config.AccountsBaseURL)
	assert.Equal(t, "https://dev.azure.com", config.DevAzureBaseURL)
	assert.Equal(t, 10*time.Minute, config.StateTTL)
	assert.Equal(t, 30*time.Second, config.HTTPTimeout)
}

func TestConfigRejectsMalformedBoolean(t *testing.T) {
	t.Setenv("AZURE_DEVOPS_ENABLED", "sometimes")
	_, err := ConfigFromEnvironment()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "AZURE_DEVOPS_ENABLED must be true or false")
}

func TestConfigManagedIdentityRequiresExplicitClientID(t *testing.T) {
	t.Setenv("SICO_ENCRYPTION_KEY", "")
	t.Setenv("AZURE_DEVOPS_ENABLED", "true")
	t.Setenv("AZURE_DEVOPS_CLIENT_ID", "11111111-1111-1111-1111-111111111111")
	t.Setenv("AZURE_CLIENT_ID", "")
	t.Setenv("AZURE_DEVOPS_PERSONAL_REDIRECT_URL", "https://test.example/personal/callback")
	t.Setenv("AZURE_DEVOPS_FRONTEND_RETURN_URL", "https://test.example/lab")
	t.Setenv("AZURE_DEVOPS_HOME_TENANT_ID", "22222222-2222-2222-2222-222222222222")
	t.Setenv(
		"SICO_ENCRYPTION_KEY",
		base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef")),
	)

	_, err := ConfigFromEnvironment()

	require.Error(t, err)
	assert.Contains(t, err.Error(), "AZURE_CLIENT_ID")
}
