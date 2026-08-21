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

type Client interface {
	SendMail(mail *Mail) error
	SendMails(mails ...*Mail) error
}

type Mail struct {
	Recipients  MailRecipients
	Content     MailContent
	Attachments []MailAttachment
}

type MailRecipients struct {
	To  []MailAddress `json:"to"`
	Cc  []MailAddress `json:"cc"`
	Bcc []MailAddress `json:"bcc"`
}

type MailAddress struct {
	Address     string `json:"address"`
	DisplayName string `json:"displayName"`
}

type MailContent struct {
	Subject   string `json:"subject"`
	PlainText string `json:"plainText"`
	Html      string `json:"html"`
}

type MailAttachment struct {
	Name          string `json:"name"`
	Base64Content string `json:"contentInBase64"`
	ContentType   string `json:"contentType"`
}
