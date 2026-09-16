package azuredevops

import (
	"context"
	"encoding/base64"
	"errors"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAESGCMCipherBindsAdditionalData(t *testing.T) {
	cipher := newTestCipher(t)
	encrypted, err := cipher.Encrypt([]byte("credential"), []byte("connection:1"))
	require.NoError(t, err)

	plaintext, err := cipher.Decrypt(encrypted, []byte("connection:1"))
	require.NoError(t, err)
	assert.Equal(t, "credential", string(plaintext))

	_, err = cipher.Decrypt(encrypted, []byte("connection:2"))
	assert.ErrorIs(t, err, ErrDecryptCredential)

	encrypted.Data[len(encrypted.Data)-1] ^= 1
	_, err = cipher.Decrypt(encrypted, []byte("connection:1"))
	assert.ErrorIs(t, err, ErrDecryptCredential)
}

func TestAESGCMCipherRequiresMatchingRootKeyAndID(t *testing.T) {
	key := base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	otherKey := base64.StdEncoding.EncodeToString([]byte("abcdef0123456789abcdef0123456789"))
	cipher := newTestCipher(t)
	encrypted, err := cipher.Encrypt([]byte("credential"), []byte("connection:1"))
	require.NoError(t, err)
	for _, test := range []struct {
		name    string
		key     string
		keyID   string
		wantErr bool
	}{
		{name: "same key after restart", key: key, keyID: "test-key"},
		{name: "different key ID", key: key, keyID: "another-key", wantErr: true},
		{name: "different key material", key: otherKey, keyID: "test-key", wantErr: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			reader, err := NewAESGCMCipher(test.key, test.keyID)
			require.NoError(t, err)
			plaintext, err := reader.Decrypt(encrypted, []byte("connection:1"))
			if test.wantErr {
				require.ErrorIs(t, err, ErrDecryptCredential)
				require.Empty(t, plaintext)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, "credential", string(plaintext))
		})
	}
}

func TestDecodeEncryptionKeyAcceptsSupportedBase64Encodings(t *testing.T) {
	key := []byte("0123456789abcdef0123456789abcdef")
	tests := []struct {
		name    string
		value   string
		wantErr bool
	}{
		{name: "padded", value: base64.StdEncoding.EncodeToString(key)},
		{name: "raw", value: base64.RawStdEncoding.EncodeToString(key)},
		{name: "malformed", value: "not-base64", wantErr: true},
		{name: "wrong length", value: base64.StdEncoding.EncodeToString(key[:16]), wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			decoded, err := decodeEncryptionKey(test.value)
			if test.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, key, decoded)
		})
	}
}

func TestRedisStateStoreConsumesStateOnce(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	store, err := NewRedisStateStore(client, newTestCipher(t), 10*time.Minute)
	require.NoError(t, err)

	stateID, err := store.Create(context.Background(), &OAuthState{
		Flow:           "personal",
		ConnectionKey:  "connection-key",
		OrganizationID: 42,
		Actor:          "alice",
		CodeVerifier:   "verifier",
	})
	require.NoError(t, err)

	state, err := store.Consume(context.Background(), stateID)
	require.NoError(t, err)
	assert.Equal(t, "verifier", state.CodeVerifier)
	_, err = store.Consume(context.Background(), stateID)
	assert.ErrorIs(t, err, ErrOAuthStateInvalid)
}

func TestMemoryStateStoreRejectsExpiredState(t *testing.T) {
	store := NewMemoryStateStore(newTestCipher(t), time.Minute)
	stateID, err := store.Create(context.Background(), &OAuthState{
		ExpiresAt: time.Now().Add(-time.Second).UnixMilli(),
	})
	require.NoError(t, err)

	_, err = store.Consume(context.Background(), stateID)
	assert.True(t, errors.Is(err, ErrOAuthStateInvalid))
}

func TestMemoryStateStoreUsesConfiguredTTL(t *testing.T) {
	ttl := time.Minute
	store := NewMemoryStateStore(newTestCipher(t), ttl)
	state := &OAuthState{}
	before := time.Now().Add(ttl).UnixMilli()

	_, err := store.Create(context.Background(), state)

	require.NoError(t, err)
	after := time.Now().Add(ttl).UnixMilli()
	assert.GreaterOrEqual(t, state.ExpiresAt, before)
	assert.LessOrEqual(t, state.ExpiresAt, after)
}

func newTestCipher(t *testing.T) *AESGCMCipher {
	t.Helper()
	key := base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	cipher, err := NewAESGCMCipher(key, "test-key")
	require.NoError(t, err)
	return cipher
}
