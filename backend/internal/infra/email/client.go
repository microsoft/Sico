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
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"sico-backend/internal/consts"
)

const (
	apiPath            = "/emails:send"
	apiVersion         = "2023-03-31"
	defaultHTTPTimeout = 30 * time.Second
)

type client struct {
	enabled    bool
	u          *url.URL
	accessKey  []byte
	senderAddr string
	httpClient *http.Client
}

func NewClient() (Client, error) {
	endpoint := strings.TrimSpace(os.Getenv(consts.MailEndpoint))
	accessKey := strings.TrimSpace(os.Getenv(consts.MailAccessKey))
	senderAddr := strings.TrimSpace(os.Getenv(consts.MailSenderAddress))
	if endpoint == "" || accessKey == "" || senderAddr == "" {
		return &client{}, nil
	}

	rawKey, err := base64.StdEncoding.DecodeString(accessKey)
	if err != nil {
		return nil, err
	}

	u, err := url.Parse(endpoint)
	if err != nil {
		return nil, err
	}

	query := url.Values{}
	query.Set("api-version", apiVersion)
	u.RawQuery = query.Encode()
	u.Path = apiPath

	return &client{
		enabled:    true,
		u:          u,
		accessKey:  rawKey,
		senderAddr: senderAddr,
		httpClient: &http.Client{Timeout: defaultHTTPTimeout},
	}, nil
}
