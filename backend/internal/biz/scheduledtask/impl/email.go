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

package impl

import (
	"context"
	"encoding/base64"
	"fmt"
	"html"
	"mime"
	"net/http"
	"path"
	"strings"
	"time"
	_ "time/tzdata"
	"unicode"

	entity "sico-backend/internal/entity/scheduledtask"
	emailinfra "sico-backend/internal/infra/email"
	"sico-backend/internal/infra/storage"
	rbacrepository "sico-backend/internal/store/rbac/repository"
	conversationdto "sico-backend/internal/transport/http/dto/conversation"
	"sico-backend/pkg/logger"
)

const (
	maxEmailAttachmentBytes      = 5 * 1024 * 1024
	maxEmailAttachmentTotalBytes = 7 * 1024 * 1024
)

type EmailClient interface {
	SendMail(mail *emailinfra.Mail) error
}

type UserRepository interface {
	GetUserByUsername(ctx context.Context, username string) (*rbacrepository.UserModel, error)
}

type DeliverableStorage interface {
	GetObject(ctx context.Context, objectKey string, opts ...storage.GetOptFn) ([]byte, error)
	GetObjectInfo(ctx context.Context, objectKey string, opts ...storage.GetOptFn) (*storage.ObjectInfo, error)
}

type completionEmailContext struct {
	plan              *conversationdto.Plan
	digitalWorkerName string
	response          string
}

func (s *Service) sendCompletionEmail(
	ctx context.Context,
	run *entity.Run,
	emailContext *completionEmailContext,
) error {
	if s.EmailClient == nil || s.UserRepository == nil || run.ExtraInfo == nil || run.ExtraInfo.Task == nil {
		return nil
	}
	user, err := s.UserRepository.GetUserByUsername(ctx, run.ExtraInfo.ReceiverUsername)
	if err != nil {
		return err
	}
	if user == nil || strings.TrimSpace(user.Email) == "" {
		return nil
	}
	mail := s.buildCompletionEmail(ctx, run, emailContext)
	mail.Recipients = emailinfra.MailRecipients{To: []emailinfra.MailAddress{{
		Address: user.Email, DisplayName: run.ExtraInfo.ReceiverUsername,
	}}}
	return s.EmailClient.SendMail(mail)
}

func (s *Service) buildCompletionEmail(
	ctx context.Context,
	run *entity.Run,
	emailContext *completionEmailContext,
) *emailinfra.Mail {
	if emailContext == nil {
		emailContext = new(completionEmailContext)
	}
	title := run.ExtraInfo.Task.GetTitle()
	status := scheduledTaskCompletionPhrase(run.ExtraInfo.PlanStatus, run.Status)
	startTime := formatEmailTime(run.StartedAt, run.ExtraInfo.Timezone)
	finishTime := formatEmailTime(run.FinishedAt, run.ExtraInfo.Timezone)
	workerName := strings.TrimSpace(emailContext.digitalWorkerName)
	if workerName == "" {
		workerName = "Digital Worker"
	}
	response := strings.TrimSpace(emailContext.response)
	if response == "" {
		response = "No response was provided."
	}
	attachments := s.buildDeliverableAttachments(ctx, selectPrimaryDeliverables(emailContext.plan))
	attachmentNote, attachmentHTML := "", ""
	if len(attachments) > 0 {
		attachmentNote = fmt.Sprintf("\n\n%s", resultAttachmentSentence(len(attachments)))
		attachmentHTML = fmt.Sprintf(
			"<p style=\"margin-top:20px\">%s</p>", resultAttachmentHTML(len(attachments)),
		)
	}
	quotedResponse := quotePlainText(response)
	plainText := fmt.Sprintf(
		"Your scheduled task %q %s.\n\nExecution time: %s – %s\n\n"+
			"Execution response from %s:\n\n%s%s",
		title, status, startTime, finishTime, workerName, quotedResponse, attachmentNote,
	)
	htmlContent := fmt.Sprintf(
		"<div style=\"font-family:Arial,sans-serif;color:#202124;line-height:1.5\">"+
			"<p>Your scheduled task <strong>%s</strong> %s.</p>"+
			"<p><strong>Execution time:</strong> %s &ndash; %s</p>"+
			"<p style=\"margin-bottom:8px\"><strong>Execution response from %s:</strong></p>"+
			"<blockquote style=\"margin:0;padding:12px 16px;border-left:4px solid #dadce0;"+
			"background:#f8f9fa;color:#3c4043\">%s</blockquote>%s</div>",
		html.EscapeString(title), html.EscapeString(status),
		html.EscapeString(startTime), html.EscapeString(finishTime),
		html.EscapeString(workerName), formatHTMLResponse(response), attachmentHTML,
	)
	return &emailinfra.Mail{
		Content: emailinfra.MailContent{
			Subject: "Scheduled task finished: " + title, PlainText: plainText, Html: htmlContent,
		},
		Attachments: attachments,
	}
}

func quotePlainText(response string) string {
	lines := strings.Split(strings.ReplaceAll(response, "\r\n", "\n"), "\n")
	for index, line := range lines {
		lines[index] = "> " + line
	}
	return strings.Join(lines, "\n")
}

func formatHTMLResponse(response string) string {
	escaped := html.EscapeString(strings.ReplaceAll(response, "\r\n", "\n"))
	return strings.ReplaceAll(escaped, "\n", "<br>")
}

func resultAttachmentSentence(count int) string {
	if count == 1 {
		return "1 result file is attached."
	}
	return fmt.Sprintf("%d result files are attached.", count)
}

func resultAttachmentHTML(count int) string {
	if count == 1 {
		return "<strong>1 result file</strong> is attached."
	}
	return fmt.Sprintf("<strong>%d result files</strong> are attached.", count)
}

func selectPrimaryDeliverables(plan *conversationdto.Plan) []*conversationdto.ToolDeliverable {
	if plan == nil {
		return nil
	}
	all := make([]*conversationdto.ToolDeliverable, 0)
	report := make([]*conversationdto.ToolDeliverable, 0)
	for _, step := range plan.GetSteps() {
		for _, toolCall := range step.GetToolCalls() {
			collectDeliverables(toolCall, &all, &report)
		}
	}
	if len(report) > 0 {
		return deduplicateDeliverables(report)
	}
	return deduplicateDeliverables(all)
}

func collectDeliverables(
	toolCall *conversationdto.ToolCall,
	all, report *[]*conversationdto.ToolDeliverable,
) {
	if toolCall == nil {
		return
	}
	isReport := strings.EqualFold(toolCall.GetExecutionInfo().GetBuiltinToolName(), "report") ||
		strings.EqualFold(toolCall.GetToolName(), "report")
	for _, deliverable := range toolCall.GetDeliverables() {
		if !isEmailDeliverable(deliverable) {
			continue
		}
		*all = append(*all, deliverable)
		if isReport {
			*report = append(*report, deliverable)
		}
	}
	for _, subCall := range toolCall.GetSubCalls() {
		collectDeliverables(subCall, all, report)
	}
}

func isEmailDeliverable(deliverable *conversationdto.ToolDeliverable) bool {
	if deliverable == nil {
		return false
	}
	switch deliverable.GetType() {
	case conversationdto.ToolDeliverableType_TOOL_DELIVERABLE_TYPE_MARKDOWN:
		return strings.TrimSpace(deliverable.GetMarkdownContent()) != ""
	case conversationdto.ToolDeliverableType_TOOL_DELIVERABLE_TYPE_FILE:
		return deliverable.GetFile() != nil && strings.TrimSpace(deliverable.GetFile().GetFileUri()) != ""
	default:
		return false
	}
}

func deduplicateDeliverables(deliverables []*conversationdto.ToolDeliverable) []*conversationdto.ToolDeliverable {
	result := make([]*conversationdto.ToolDeliverable, 0, len(deliverables))
	seen := make(map[string]struct{}, len(deliverables))
	for _, deliverable := range deliverables {
		key := deliverableKey(deliverable)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, deliverable)
	}
	return result
}

func deliverableKey(deliverable *conversationdto.ToolDeliverable) string {
	if deliverable.GetType() == conversationdto.ToolDeliverableType_TOOL_DELIVERABLE_TYPE_FILE {
		return "file:" + deliverable.GetFile().GetFileUri()
	}
	return "markdown:" + deliverable.GetMarkdownTitle() + "\x00" + deliverable.GetMarkdownContent()
}

func (s *Service) buildDeliverableAttachments(
	ctx context.Context,
	deliverables []*conversationdto.ToolDeliverable,
) []emailinfra.MailAttachment {
	attachments := make([]emailinfra.MailAttachment, 0, len(deliverables))
	usedNames := make(map[string]int)
	totalBytes := 0
	for index, deliverable := range deliverables {
		attachment, size, ok := s.buildDeliverableAttachment(ctx, deliverable, index+1, totalBytes, usedNames)
		if !ok {
			continue
		}
		attachments = append(attachments, attachment)
		totalBytes += size
	}
	return attachments
}

func (s *Service) buildDeliverableAttachment(
	ctx context.Context,
	deliverable *conversationdto.ToolDeliverable,
	index, totalBytes int,
	usedNames map[string]int,
) (emailinfra.MailAttachment, int, bool) {
	switch deliverable.GetType() {
	case conversationdto.ToolDeliverableType_TOOL_DELIVERABLE_TYPE_MARKDOWN:
		return buildMarkdownAttachment(deliverable, index, totalBytes, usedNames)
	case conversationdto.ToolDeliverableType_TOOL_DELIVERABLE_TYPE_FILE:
		return s.buildFileAttachment(ctx, deliverable.GetFile(), totalBytes, usedNames)
	default:
		return emailinfra.MailAttachment{}, 0, false
	}
}

func buildMarkdownAttachment(
	deliverable *conversationdto.ToolDeliverable,
	index, totalBytes int,
	usedNames map[string]int,
) (emailinfra.MailAttachment, int, bool) {
	content := []byte(deliverable.GetMarkdownContent())
	if !attachmentSizeAllowed(len(content), totalBytes) {
		return emailinfra.MailAttachment{}, 0, false
	}
	name := strings.TrimSpace(deliverable.GetMarkdownTitle())
	if name == "" {
		name = fmt.Sprintf("result-%d", index)
	}
	if !strings.EqualFold(path.Ext(name), ".md") {
		name += ".md"
	}
	return newMailAttachment(uniqueAttachmentName(name, usedNames), "text/markdown; charset=utf-8", content),
		len(content), true
}

func (s *Service) buildFileAttachment(
	ctx context.Context,
	file *conversationdto.ToolDeliverableFile,
	totalBytes int,
	usedNames map[string]int,
) (emailinfra.MailAttachment, int, bool) {
	if s.DeliverableStorage == nil {
		return emailinfra.MailAttachment{}, 0, false
	}
	fileURI := strings.TrimSpace(file.GetFileUri())
	if fileURI == "" || strings.HasPrefix(strings.ToLower(fileURI), "http://") ||
		strings.HasPrefix(strings.ToLower(fileURI), "https://") {
		return emailinfra.MailAttachment{}, 0, false
	}
	info, err := s.DeliverableStorage.GetObjectInfo(ctx, fileURI, storage.WithGetPathPrefix(""))
	if err != nil {
		logger.CtxWarn(ctx, "scheduled task email deliverable info failed uri=%s err=%v", fileURI, err)
		return emailinfra.MailAttachment{}, 0, false
	}
	if info == nil {
		logger.CtxWarn(ctx, "scheduled task email deliverable info missing uri=%s", fileURI)
		return emailinfra.MailAttachment{}, 0, false
	}
	if info.Size > maxEmailAttachmentBytes || int64(totalBytes)+info.Size > maxEmailAttachmentTotalBytes {
		logger.CtxWarn(ctx, "scheduled task email deliverable skipped oversized uri=%s size=%d", fileURI, info.Size)
		return emailinfra.MailAttachment{}, 0, false
	}
	content, err := s.DeliverableStorage.GetObject(ctx, fileURI, storage.WithGetPathPrefix(""))
	if err != nil {
		logger.CtxWarn(ctx, "scheduled task email deliverable download failed uri=%s err=%v", fileURI, err)
		return emailinfra.MailAttachment{}, 0, false
	}
	if !attachmentSizeAllowed(len(content), totalBytes) {
		return emailinfra.MailAttachment{}, 0, false
	}
	name := strings.TrimSpace(file.GetFileName())
	if name == "" {
		name = path.Base(fileURI)
	}
	contentType := strings.TrimSpace(info.ContentType)
	if contentType == "" {
		contentType = mime.TypeByExtension(path.Ext(name))
	}
	if contentType == "" {
		contentType = http.DetectContentType(content)
	}
	return newMailAttachment(uniqueAttachmentName(name, usedNames), contentType, content), len(content), true
}

func attachmentSizeAllowed(size, totalBytes int) bool {
	return size <= maxEmailAttachmentBytes && totalBytes+size <= maxEmailAttachmentTotalBytes
}

func newMailAttachment(name, contentType string, content []byte) emailinfra.MailAttachment {
	return emailinfra.MailAttachment{
		Name:          sanitizeAttachmentName(name),
		Base64Content: base64.StdEncoding.EncodeToString(content),
		ContentType:   contentType,
	}
}

func sanitizeAttachmentName(name string) string {
	name = strings.TrimSpace(name)
	name = strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || unicode.IsControl(r) {
			return '_'
		}
		return r
	}, name)
	if name == "" || name == "." {
		return "result"
	}
	return name
}

func uniqueAttachmentName(name string, usedNames map[string]int) string {
	name = sanitizeAttachmentName(name)
	key := strings.ToLower(name)
	usedNames[key]++
	if usedNames[key] == 1 {
		return name
	}
	extension := path.Ext(name)
	base := strings.TrimSuffix(name, extension)
	return fmt.Sprintf("%s-%d%s", base, usedNames[key], extension)
}

func scheduledTaskCompletionPhrase(planStatus conversationdto.PlanStatus, runStatus entity.RunStatus) string {
	switch planStatus {
	case conversationdto.PlanStatus_PLAN_STATUS_COMPLETED,
		conversationdto.PlanStatus_PLAN_STATUS_NO_PLAN:
		return "has been completed successfully"
	case conversationdto.PlanStatus_PLAN_STATUS_FAILED:
		return "has failed"
	case conversationdto.PlanStatus_PLAN_STATUS_REQUIRE_HUMAN_INPUT:
		return "needs human input"
	case conversationdto.PlanStatus_PLAN_STATUS_CANCELLED:
		return "has been cancelled"
	default:
		if runStatus == entity.RunStatusFailed {
			return "has failed"
		}
		return "has finished"
	}
}

func formatEmailTime(timestampMillis int64, timezone string) string {
	location, err := time.LoadLocation(strings.TrimSpace(timezone))
	if err != nil {
		location = time.UTC
	}
	return time.UnixMilli(timestampMillis).In(location).Format("January 2, 2006 at 3:04 PM MST")
}
