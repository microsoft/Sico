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

package email

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"sico-backend/internal/consts"
)

func configureEmail(t *testing.T, endpoint string) {
	t.Helper()
	t.Setenv(consts.MailEndpoint, endpoint)
	t.Setenv(consts.MailAccessKey, base64.StdEncoding.EncodeToString([]byte("test-access-key")))
	t.Setenv(consts.MailSenderAddress, "noreply@example.com")
}

func sampleMail() *Mail {
	return &Mail{
		Recipients: MailRecipients{To: []MailAddress{{Address: "user@example.com"}}},
		Content:    MailContent{Subject: "Test", Html: "<p>hello</p>"},
	}
}

func TestNewClientMissingConfigurationIsNoOp(t *testing.T) {
	variables := []string{consts.MailEndpoint, consts.MailAccessKey, consts.MailSenderAddress}
	for _, variable := range variables {
		t.Run(variable, func(t *testing.T) {
			configureEmail(t, "https://example.com")
			t.Setenv(variable, " ")

			client, err := NewClient()
			require.NoError(t, err)
			require.NoError(t, client.SendMail(nil))
			require.NoError(t, client.SendMails(nil, nil))
		})
	}
}

func TestSendMailAccepted(t *testing.T) {
	var got mailMessage
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, apiPath, r.URL.Path)
		assert.Equal(t, apiVersion, r.URL.Query().Get("api-version"))
		assert.NotEmpty(t, r.Header.Get("Authorization"))
		require.NoError(t, json.NewDecoder(r.Body).Decode(&got))
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()
	configureEmail(t, server.URL)

	client, err := NewClient()
	require.NoError(t, err)
	require.NoError(t, client.SendMail(sampleMail()))
	assert.Equal(t, "noreply@example.com", got.SenderAddr)
	assert.True(t, got.UserEngagementTrackingDisabled)
}

func TestSendMailErrorResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = io.WriteString(w, `{"error":{"code":"TooManyRequests","message":"Please try again"}}`)
	}))
	defer server.Close()
	configureEmail(t, server.URL)

	client, err := NewClient()
	require.NoError(t, err)
	err = client.SendMail(sampleMail())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "status=429")
	assert.Contains(t, err.Error(), "code=TooManyRequests")
}
