package azuredevops

import (
	"encoding/base64"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSICOKeyRenameReadsExistingCredentials(t *testing.T) {
	encoded := base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	t.Setenv("AZURE_DEVOPS_ENABLED", "false")
	oldCipher, err := NewAESGCMCipher(encoded, credentialKeyID)
	require.NoError(t, err)
	aad := CredentialAAD(17, 1, ProviderKey, 1)
	oldData, err := oldCipher.Encrypt([]byte("saved refresh token"), aad)
	require.NoError(t, err)

	t.Setenv("SICO_ENCRYPTION_KEY", encoded)
	newConfig, err := ConfigFromEnvironment()
	require.NoError(t, err)
	newCipher, err := NewAESGCMCipher(newConfig.CredentialKey, credentialKeyID)
	require.NoError(t, err)
	plaintext, err := newCipher.Decrypt(oldData, aad)
	require.NoError(t, err)
	require.Equal(t, "saved refresh token", string(plaintext))
	newData, err := newCipher.Encrypt([]byte("new refresh token"), aad)
	require.NoError(t, err)
	plaintext, err = oldCipher.Decrypt(newData, aad)
	require.NoError(t, err)
	require.Equal(t, "new refresh token", string(plaintext))
	require.Equal(t, oldData.KeyID, newData.KeyID)

}
