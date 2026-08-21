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
	"testing"

	"github.com/stretchr/testify/require"

	entity "sico-backend/internal/entity/scheduledtask"
	"sico-backend/internal/infra/storage"
	commondto "sico-backend/internal/transport/http/dto/common"
	conversationdto "sico-backend/internal/transport/http/dto/conversation"
)

type fakeDeliverableStorage struct {
	content  map[string][]byte
	info     map[string]*storage.ObjectInfo
	getCalls []string
}

func (s *fakeDeliverableStorage) GetObject(
	_ context.Context,
	objectKey string,
	_ ...storage.GetOptFn,
) ([]byte, error) {
	s.getCalls = append(s.getCalls, objectKey)
	return s.content[objectKey], nil
}

func (s *fakeDeliverableStorage) GetObjectInfo(
	_ context.Context,
	objectKey string,
	_ ...storage.GetOptFn,
) (*storage.ObjectInfo, error) {
	return s.info[objectKey], nil
}

func TestSelectPrimaryDeliverablesPrefersReportOutput(t *testing.T) {
	other := markdownDeliverable("Other", "other output")
	report := fileDeliverable("report.pdf", "project/report.pdf")
	plan := planWithToolCalls(
		&conversationdto.ToolCall{ToolName: "Analyze", Deliverables: []*conversationdto.ToolDeliverable{other}},
		&conversationdto.ToolCall{
			ToolName: "Wrapper",
			SubCalls: []*conversationdto.ToolCall{{
				ToolName:      "Report",
				ExecutionInfo: &conversationdto.ToolExecutionInfo{BuiltinToolName: "report"},
				Deliverables:  []*conversationdto.ToolDeliverable{report},
			}},
		},
	)

	selected := selectPrimaryDeliverables(plan)

	require.Equal(t, []*conversationdto.ToolDeliverable{report}, selected)
}

func TestSelectPrimaryDeliverablesFallsBackWhenReportHasNoOutput(t *testing.T) {
	other := markdownDeliverable("Analysis", "fallback output")
	plan := planWithToolCalls(
		&conversationdto.ToolCall{ToolName: "Analyze", Deliverables: []*conversationdto.ToolDeliverable{other}},
		&conversationdto.ToolCall{
			ToolName:      "Report",
			ExecutionInfo: &conversationdto.ToolExecutionInfo{BuiltinToolName: "report"},
		},
	)

	selected := selectPrimaryDeliverables(plan)

	require.Equal(t, []*conversationdto.ToolDeliverable{other}, selected)
}

func TestBuildDeliverableAttachmentsIncludesMarkdownAndFile(t *testing.T) {
	fileContent := []byte("pdf content")
	storageClient := &fakeDeliverableStorage{
		content: map[string][]byte{"project/report.pdf": fileContent},
		info: map[string]*storage.ObjectInfo{
			"project/report.pdf": {Size: int64(len(fileContent)), ContentType: "application/pdf"},
		},
	}
	service := NewService(&Components{DeliverableStorage: storageClient})
	deliverables := []*conversationdto.ToolDeliverable{
		markdownDeliverable("Summary", "# Result\nDone"),
		fileDeliverable("report.pdf", "project/report.pdf"),
	}

	attachments := service.buildDeliverableAttachments(context.Background(), deliverables)

	require.Len(t, attachments, 2)
	require.Equal(t, "Summary.md", attachments[0].Name)
	require.Equal(t, "text/markdown; charset=utf-8", attachments[0].ContentType)
	markdownContent, err := base64.StdEncoding.DecodeString(attachments[0].Base64Content)
	require.NoError(t, err)
	require.Equal(t, "# Result\nDone", string(markdownContent))
	require.Equal(t, "report.pdf", attachments[1].Name)
	require.Equal(t, "application/pdf", attachments[1].ContentType)
	decodedFile, err := base64.StdEncoding.DecodeString(attachments[1].Base64Content)
	require.NoError(t, err)
	require.Equal(t, fileContent, decodedFile)
	require.Equal(t, []string{"project/report.pdf"}, storageClient.getCalls)
}

func TestBuildDeliverableAttachmentsDeduplicatesNamesAndSkipsOversizedFile(t *testing.T) {
	storageClient := &fakeDeliverableStorage{
		content: map[string][]byte{},
		info: map[string]*storage.ObjectInfo{
			"project/large.bin": {Size: maxEmailAttachmentBytes + 1},
		},
	}
	service := NewService(&Components{DeliverableStorage: storageClient})
	deliverables := []*conversationdto.ToolDeliverable{
		markdownDeliverable("Result", "first"),
		markdownDeliverable("Result", "second"),
		fileDeliverable("large.bin", "project/large.bin"),
	}

	attachments := service.buildDeliverableAttachments(context.Background(), deliverables)

	require.Len(t, attachments, 2)
	require.Equal(t, "Result.md", attachments[0].Name)
	require.Equal(t, "Result-2.md", attachments[1].Name)
	require.Empty(t, storageClient.getCalls)
}

func TestBuildCompletionEmailMentionsAttachedResults(t *testing.T) {
	service := NewService(&Components{})
	run := &entity.Run{ExtraInfo: &entity.RunExtraInfo{
		Task:       &commondto.ScheduledTaskDigest{Title: "Daily report"},
		PlanStatus: conversationdto.PlanStatus_PLAN_STATUS_COMPLETED,
	}}
	plan := planWithToolCalls(&conversationdto.ToolCall{
		Deliverables: []*conversationdto.ToolDeliverable{markdownDeliverable("Summary", "done")},
	})

	mail := service.buildCompletionEmail(context.Background(), run, &completionEmailContext{
		plan:              plan,
		digitalWorkerName: "Research Worker",
		response:          "The report is ready.\nPlease review it.",
	})

	require.Len(t, mail.Attachments, 1)
	require.Contains(t, mail.Content.PlainText, "Your scheduled task \"Daily report\" has been completed successfully.")
	require.Contains(t, mail.Content.PlainText, "Execution response from Research Worker:")
	require.Contains(t, mail.Content.PlainText, "> The report is ready.\n> Please review it.")
	require.Contains(t, mail.Content.PlainText, "1 result file is attached.")
	require.Contains(t, mail.Content.Html, "Execution response from Research Worker:")
	require.Contains(t, mail.Content.Html, "The report is ready.<br>Please review it.")
	require.Contains(t, mail.Content.Html, "<strong>1 result file</strong> is attached.")
}

func planWithToolCalls(toolCalls ...*conversationdto.ToolCall) *conversationdto.Plan {
	return &conversationdto.Plan{Steps: []*conversationdto.PlanStep{{ToolCalls: toolCalls}}}
}

func markdownDeliverable(title, content string) *conversationdto.ToolDeliverable {
	return &conversationdto.ToolDeliverable{
		Type:            conversationdto.ToolDeliverableType_TOOL_DELIVERABLE_TYPE_MARKDOWN,
		MarkdownTitle:   title,
		MarkdownContent: content,
	}
}

func fileDeliverable(name, uri string) *conversationdto.ToolDeliverable {
	return &conversationdto.ToolDeliverable{
		Type: conversationdto.ToolDeliverableType_TOOL_DELIVERABLE_TYPE_FILE,
		File: &conversationdto.ToolDeliverableFile{FileName: name, FileUri: uri},
	}
}
