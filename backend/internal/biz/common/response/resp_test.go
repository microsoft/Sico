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
