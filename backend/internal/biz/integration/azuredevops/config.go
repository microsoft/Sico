package azuredevops

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"sico-backend/pkg/encryptionkey"
)

const (
	ProviderKey              = "azure_devops"
	FlowPersonal             = "personal"
	azureDevOpsResourceScope = "499b84ac-1321-427f-aa17-267ca6975798/.default"
	personalDelegatedScopes  = azureDevOpsResourceScope
)

type Config struct {
	Enabled bool

	ClientID          string
	HomeTenantID      string
	AssertionClientID string

	PersonalRedirectURL string
	FrontendReturnURL   string
	AuthorityURL        string
	OAuthTenant         string
	PersonalOAuthScopes string

	ProfileBaseURL  string
	AccountsBaseURL string
	DevAzureBaseURL string

	CredentialKey string

	StateTTL    time.Duration
	HTTPTimeout time.Duration
}

func ConfigFromEnvironment() (Config, error) {
	enabled, err := envBool("AZURE_DEVOPS_ENABLED")
	if err != nil {
		return Config{}, err
	}
	credentialKey, err := encryptionkey.FromEnvironment()
	if enabled && err != nil {
		return Config{}, err
	}

	homeTenantID := strings.TrimSpace(os.Getenv("AZURE_DEVOPS_HOME_TENANT_ID"))

	config := Config{
		Enabled: enabled,

		ClientID:          strings.TrimSpace(os.Getenv("AZURE_DEVOPS_CLIENT_ID")),
		HomeTenantID:      homeTenantID,
		AssertionClientID: strings.TrimSpace(os.Getenv("AZURE_CLIENT_ID")),

		PersonalRedirectURL: strings.TrimSpace(os.Getenv("AZURE_DEVOPS_PERSONAL_REDIRECT_URL")),
		FrontendReturnURL:   strings.TrimSpace(os.Getenv("AZURE_DEVOPS_FRONTEND_RETURN_URL")),
		AuthorityURL:        "https://login.microsoftonline.com",
		OAuthTenant:         homeTenantID,
		PersonalOAuthScopes: personalDelegatedScopes,

		ProfileBaseURL:  "https://app.vssps.visualstudio.com",
		AccountsBaseURL: "https://app.vssps.visualstudio.com",
		DevAzureBaseURL: "https://dev.azure.com",

		CredentialKey: base64.StdEncoding.EncodeToString(credentialKey),

		StateTTL:    10 * time.Minute,
		HTTPTimeout: 30 * time.Second,
	}

	if err := config.Validate(); err != nil {
		return Config{}, err
	}

	return config, nil
}

func (c Config) Validate() error {
	if !c.Enabled {
		return nil
	}

	checks := []func() error{
		c.validateRequiredValues,
		c.validateIdentifiers,
		c.validateRedirectURLs,
		c.validateGeneralSettings,
	}
	for _, check := range checks {
		if err := check(); err != nil {
			return err
		}
	}

	return nil
}

func (c Config) validateGeneralSettings() error {
	if c.StateTTL <= 0 || c.HTTPTimeout <= 0 {
		return errors.New("azure devops state TTL and HTTP timeout must be positive")
	}

	if c.PersonalOAuthScopes == "" {
		return errors.New("azure devops OAuth scopes are required")
	}

	return nil
}

func (c Config) validateRequiredValues() error {
	required := []struct {
		name  string
		value string
	}{
		{name: "AZURE_DEVOPS_CLIENT_ID", value: c.ClientID},
		{name: "AZURE_DEVOPS_PERSONAL_REDIRECT_URL", value: c.PersonalRedirectURL},
		{name: "AZURE_DEVOPS_FRONTEND_RETURN_URL", value: c.FrontendReturnURL},
		{name: "AZURE_DEVOPS_HOME_TENANT_ID", value: c.HomeTenantID},
		{name: "AZURE_CLIENT_ID", value: c.AssertionClientID},
		{name: "SICO_ENCRYPTION_KEY", value: c.CredentialKey},
	}

	for _, item := range required {
		if strings.TrimSpace(item.value) == "" {
			return errors.New(item.name + " is required when AZURE_DEVOPS_ENABLED=true")
		}
	}

	return nil
}

func (c Config) validateIdentifiers() error {
	if _, err := uuid.Parse(c.ClientID); err != nil {
		return errors.New("AZURE_DEVOPS_CLIENT_ID must be a UUID")
	}

	if _, err := uuid.Parse(c.HomeTenantID); err != nil {
		return errors.New("AZURE_DEVOPS_HOME_TENANT_ID must be a UUID")
	}

	if c.AssertionClientID != "" {
		if _, err := uuid.Parse(c.AssertionClientID); err != nil {
			return errors.New("AZURE_CLIENT_ID must be a UUID")
		}
	}

	return nil
}

func (c Config) validateRedirectURLs() error {
	values := []string{c.PersonalRedirectURL, c.FrontendReturnURL}
	for _, value := range values {
		parsed, err := url.Parse(value)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			return errors.New("azure devops redirect URLs must be absolute")
		}
	}

	return nil
}

func envBool(name string) (bool, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return false, nil
	}

	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return false, fmt.Errorf("%s must be true or false", name)
	}

	return parsed, nil
}
