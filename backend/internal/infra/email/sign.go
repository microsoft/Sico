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
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

func (c *client) generateSignedMessageRequest(message mailMessage) (*http.Request, error) {
	body, err := json.Marshal(message)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest(http.MethodPost, c.u.String(), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}

	pathAndQuery := fmt.Sprintf("%s?%s", c.u.Path, c.u.Query().Encode())
	timestamp := strings.ReplaceAll(time.Now().UTC().Format(time.RFC1123), "UTC", "GMT")
	hash := sha256.Sum256(body)
	hashBase64 := base64.StdEncoding.EncodeToString(hash[:])
	stringToSign := fmt.Sprintf(
		"%s\n%s\n%s;%s;%s",
		http.MethodPost, pathAndQuery, timestamp, c.u.Host, hashBase64,
	)

	hmacHash := hmac.New(sha256.New, c.accessKey)
	if _, err = hmacHash.Write([]byte(stringToSign)); err != nil {
		return nil, err
	}

	signature := base64.StdEncoding.EncodeToString(hmacHash.Sum(nil))
	authorization := fmt.Sprintf("HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=%s", signature)

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-ms-date", timestamp)
	req.Header.Set("x-ms-content-sha256", hashBase64)
	req.Header.Set("Authorization", authorization)

	return req, nil
}
