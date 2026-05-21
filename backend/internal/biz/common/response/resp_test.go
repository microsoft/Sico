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

package response

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

type testResp struct {
	Code int32  `json:"code"`
	Msg  string `json:"msg"`
	Data string `json:"data"`
}

func TestSuccess(t *testing.T) {
	resp := &testResp{Data: "hello"}
	result := Success(resp)

	assert.Same(t, resp, result, "should return the same pointer")
	assert.Equal(t, int32(0), result.Code)
	assert.Equal(t, "success", result.Msg)
	assert.Equal(t, "hello", result.Data, "data field should be untouched")
}

func TestSuccess_NilPointer(t *testing.T) {
	var resp *testResp
	result := Success(resp)
	assert.Nil(t, result, "nil input should return nil")
}

type noCodeResp struct {
	Data string
}

func TestSuccess_NoCodeField(t *testing.T) {
	resp := &noCodeResp{Data: "d"}
	result := Success(resp)
	assert.Equal(t, "d", result.Data, "should not panic on structs without Code/Msg")
}
