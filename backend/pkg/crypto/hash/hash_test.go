// Copyright (c) 2026 Sico Authors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

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
