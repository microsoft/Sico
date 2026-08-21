package hash

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGenerateAndComparePassword(t *testing.T) {
	password := "my-secure-password"

	hashed, err := GeneratePassword(password)
	require.NoError(t, err)
	assert.NotEmpty(t, hashed)
	assert.NotEqual(t, password, hashed, "hashed password must not equal plaintext")

	err = CompareHashAndPassword(hashed, password)
	assert.NoError(t, err, "correct password should match")

	err = CompareHashAndPassword(hashed, "wrong-password")
	assert.Error(t, err, "wrong password should not match")
}

func TestGeneratePassword_DifferentHashesForSameInput(t *testing.T) {
	h1, err := GeneratePassword("same")
	require.NoError(t, err)
	h2, err := GeneratePassword("same")
	require.NoError(t, err)

	assert.NotEqual(t, h1, h2, "bcrypt should produce different hashes each time (random salt)")
}
