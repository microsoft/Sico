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
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type mailMessage struct {
	Attachments                    []MailAttachment `json:"attachments,omitempty"`
	Content                        MailContent      `json:"content"`
	Recipients                     MailRecipients   `json:"recipients"`
	ReplyTo                        []MailAddress    `json:"replyTo,omitempty"`
	SenderAddr                     string           `json:"senderAddress"`
	UserEngagementTrackingDisabled bool             `json:"userEngagementTrackingDisabled"`
}

func (c *client) newMailMessage(mail Mail) mailMessage {
	return mailMessage{
		Attachments:                    mail.Attachments,
		Content:                        mail.Content,
		Recipients:                     mail.Recipients,
		SenderAddr:                     c.senderAddr,
		UserEngagementTrackingDisabled: true,
	}
}

func (c *client) SendMail(mail *Mail) error {
	if !c.enabled {
		return nil
	}

	return c.sendMessage(c.newMailMessage(*mail))
}

func (c *client) SendMails(mails ...*Mail) error {
	if !c.enabled {
		return nil
	}

	var errs []error
	for _, mail := range mails {
		if err := c.SendMail(mail); err != nil {
			errs = append(errs, err)
		}
	}

	return errors.Join(errs...)
}

type errorResponse struct {
	Error struct {
		AdditionalInfo []struct {
			Info any    `json:"info"`
			Type string `json:"type"`
		} `json:"additionalInfo"`
		Code    string          `json:"code"`
		Details []errorResponse `json:"details"`
		Message string          `json:"message"`
		Target  string          `json:"target"`
	} `json:"error"`
}

func (c *client) sendMessage(message mailMessage) error {
	req, err := c.generateSignedMessageRequest(message)
	if err != nil {
		return fmt.Errorf("build signed request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode == http.StatusAccepted {
		return nil
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response body (status %s): %w", resp.Status, err)
	}

	return errors.New(formatAzureError(resp.Status, body))
}

func formatAzureError(status string, body []byte) string {
	var parsed errorResponse
	if len(body) > 0 && json.Unmarshal(body, &parsed) == nil && (parsed.Error.Code != "" || parsed.Error.Message != "") {
		message := strings.TrimSpace(parsed.Error.Message)
		code := strings.TrimSpace(parsed.Error.Code)
		switch {
		case code != "" && message != "":
			return fmt.Sprintf("azure email send failed: status=%s code=%s message=%s", status, code, message)
		case code != "":
			return fmt.Sprintf("azure email send failed: status=%s code=%s", status, code)
		default:
			return fmt.Sprintf("azure email send failed: status=%s message=%s", status, message)
		}
	}

	if raw := strings.TrimSpace(string(body)); raw != "" {
		return fmt.Sprintf("azure email send failed: status=%s body=%s", status, raw)
	}
	return fmt.Sprintf("azure email send failed: status=%s", status)
}
