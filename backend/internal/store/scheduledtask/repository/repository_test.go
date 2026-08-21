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

package repository

import (
	"testing"

	"github.com/stretchr/testify/require"

	commondto "sico-backend/internal/transport/http/dto/common"
	scheduledtaskdto "sico-backend/internal/transport/http/dto/scheduledtask"
)

func TestMarshalTaskAttachments(t *testing.T) {
	value, err := marshalTaskAttachments([]*commondto.Attachment{{
		Name: "report.csv",
		Uri:  "project/report.csv",
		Type: "text/csv",
		Size: 42,
		Id:   7,
	}})

	require.NoError(t, err)
	require.JSONEq(t, `[{
		"name":"report.csv",
		"uri":"project/report.csv",
		"type":"text/csv",
			"sasUrl":"",
		"size":42,
		"id":7
	}]`, string(value))
}

func TestMarshalTaskAttachmentsEmpty(t *testing.T) {
	value, err := marshalTaskAttachments([]*commondto.Attachment{})

	require.NoError(t, err)
	require.JSONEq(t, `[]`, string(value))
}

func TestMarshalTaskExtraInfo(t *testing.T) {
	value, err := marshalTaskExtraInfo(&scheduledtaskdto.ScheduledTaskExtraInfo{
		SendEmailOnComplete: true,
	})

	require.NoError(t, err)
	require.JSONEq(t, `{"sendEmailOnComplete":true}`, string(value))
}

func TestMarshalTaskExtraInfoNil(t *testing.T) {
	value, err := marshalTaskExtraInfo(nil)

	require.NoError(t, err)
	require.Nil(t, value)
}
