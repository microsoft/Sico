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
	"errors"
	"io"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"

	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/errcode"
	llmhubpb "sico-backend/internal/transport/grpc/pb/llmhubs"
	dto "sico-backend/internal/transport/http/dto/llmhubs"
)

// ─── mocks ──────────────────────────────────────────────────────────────────────

type mockLLMHubRPCClient struct {
	mock.Mock
}

func (m *mockLLMHubRPCClient) RuntimeGenerate(
	ctx context.Context,
	in *llmhubpb.RuntimeGenerateRequest,
	opts ...grpc.CallOption,
) (*llmhubpb.RuntimeGenerateResponse, error) {
	args := m.Called(ctx, in)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*llmhubpb.RuntimeGenerateResponse), args.Error(1)
}

func (m *mockLLMHubRPCClient) RuntimeGenerateStream(
	ctx context.Context,
	in *llmhubpb.RuntimeGenerateRequest,
	opts ...grpc.CallOption,
) (grpc.ServerStreamingClient[llmhubpb.RuntimeStreamChunk], error) {
	args := m.Called(ctx, in)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(grpc.ServerStreamingClient[llmhubpb.RuntimeStreamChunk]), args.Error(1)
}

func (m *mockLLMHubRPCClient) ListBuiltinModels(
	ctx context.Context,
	in *llmhubpb.ListBuiltinModelsRequest,
	opts ...grpc.CallOption,
) (*llmhubpb.ListBuiltinModelsResponse, error) {
	args := m.Called(ctx, in)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*llmhubpb.ListBuiltinModelsResponse), args.Error(1)
}

type mockStreamClient struct {
	chunks []*llmhubpb.RuntimeStreamChunk
	index  int
	err    error
}

func (m *mockStreamClient) Recv() (*llmhubpb.RuntimeStreamChunk, error) {
	if m.err != nil {
		return nil, m.err
	}
	if m.index >= len(m.chunks) {
		return nil, io.EOF
	}
	chunk := m.chunks[m.index]
	m.index++
	return chunk, nil
}

func (m *mockStreamClient) Header() (metadata.MD, error)    { return nil, nil }
func (m *mockStreamClient) Trailer() metadata.MD              { return nil }
func (m *mockStreamClient) CloseSend() error                  { return nil }
func (m *mockStreamClient) Context() context.Context          { return context.Background() }
func (m *mockStreamClient) SendMsg(msg any) error             { return nil }
func (m *mockStreamClient) RecvMsg(msg any) error             { return nil }

// ensure interface compliance
var _ grpc.ServerStreamingClient[llmhubpb.RuntimeStreamChunk] = (*mockStreamClient)(nil)

// ─── NewService ─────────────────────────────────────────────────────────────────

func TestNewService_NilConn(t *testing.T) {
	svc := NewService(nil)
	require.NotNil(t, svc)
	assert.Nil(t, svc.runtimeClient)
}

// ─── ListBuiltinModels ─────────────────────────────────────────────────────────

func TestListBuiltinModels(t *testing.T) {
	tests := []struct {
		name      string
		client    func() *mockLLMHubRPCClient
		wantErr   bool
		errCode   int32
		wantCount int
	}{
		{
			name:    "nil client returns unavailable error",
			client:  nil,
			wantErr: true,
			errCode: errcode.CommonUnavailable,
		},
		{
			name: "gRPC transport error",
			client: func() *mockLLMHubRPCClient {
				c := new(mockLLMHubRPCClient)
				c.On("ListBuiltinModels", mock.Anything, mock.Anything).
					Return(nil, errors.New("connection refused"))
				return c
			},
			wantErr: true,
			errCode: errcode.CommonInternalError,
		},
		{
			name: "upstream non-zero code",
			client: func() *mockLLMHubRPCClient {
				c := new(mockLLMHubRPCClient)
				c.On("ListBuiltinModels", mock.Anything, mock.Anything).
					Return(&llmhubpb.ListBuiltinModelsResponse{Code: 1, Msg: "core error"}, nil)
				return c
			},
			wantErr: true,
			errCode: errcode.CommonInternalError,
		},
		{
			name: "upstream non-zero code with empty msg",
			client: func() *mockLLMHubRPCClient {
				c := new(mockLLMHubRPCClient)
				c.On("ListBuiltinModels", mock.Anything, mock.Anything).
					Return(&llmhubpb.ListBuiltinModelsResponse{Code: 1}, nil)
				return c
			},
			wantErr: true,
		},
		{
			name: "success with models",
			client: func() *mockLLMHubRPCClient {
				c := new(mockLLMHubRPCClient)
				c.On("ListBuiltinModels", mock.Anything, mock.Anything).
					Return(&llmhubpb.ListBuiltinModelsResponse{
						Models: []*llmhubpb.BuiltinModelEntry{
							{
								ModelKey:             "gpt-4",
								DisplayName:          "GPT-4",
								ModelType:            2,
								ProviderTemplateType: 1,
							},
							nil, // should be skipped
							{ModelKey: "claude", DisplayName: "Claude", ModelType: 1},
						},
					}, nil)
				return c
			},
			wantCount: 2,
		},
		{
			name: "success with empty list",
			client: func() *mockLLMHubRPCClient {
				c := new(mockLLMHubRPCClient)
				c.On("ListBuiltinModels", mock.Anything, mock.Anything).
					Return(&llmhubpb.ListBuiltinModelsResponse{}, nil)
				return c
			},
			wantCount: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := &Service{}
			if tt.client != nil {
				svc.runtimeClient = tt.client()
			}

			entries, err := svc.ListBuiltinModels(context.Background())
			if tt.wantErr {
				require.Error(t, err)
				if tt.errCode != 0 {
					ae, ok := apperr.As(err)
					require.True(t, ok, "expected apperr.Error")
					assert.Equal(t, tt.errCode, ae.Code())
				}
				return
			}

			require.NoError(t, err)
			assert.Len(t, entries, tt.wantCount)

			if tt.wantCount > 0 {
				assert.Equal(t, "gpt-4", entries[0].ModelKey)
				assert.True(t, entries[0].IsBuiltin)
				assert.Equal(t, int32(1), entries[0].Status)
			}
		})
	}
}

// ─── RuntimeGenerate ────────────────────────────────────────────────────────────

func TestRuntimeGenerate(t *testing.T) {
	tests := []struct {
		name    string
		client  func() *mockLLMHubRPCClient
		req     *dto.RuntimeGenerateRequest
		wantErr bool
		errCode int32
		check   func(t *testing.T, resp *dto.RuntimeGenerateResponse)
	}{
		{
			name:    "nil client returns unavailable",
			client:  nil,
			req:     &dto.RuntimeGenerateRequest{Model: "gpt-4"},
			wantErr: true,
			errCode: errcode.CommonUnavailable,
		},
		{
			name: "empty model returns invalid param",
			client: func() *mockLLMHubRPCClient {
				return new(mockLLMHubRPCClient)
			},
			req:     &dto.RuntimeGenerateRequest{Model: ""},
			wantErr: true,
			errCode: errcode.CommonInvalidParam,
		},
		{
			name: "gRPC transport error",
			client: func() *mockLLMHubRPCClient {
				c := new(mockLLMHubRPCClient)
				c.On("RuntimeGenerate", mock.Anything, mock.Anything).
					Return(nil, errors.New("unavailable"))
				return c
			},
			req:     &dto.RuntimeGenerateRequest{Model: "gpt-4"},
			wantErr: true,
			errCode: errcode.LLMHubRuntimeFailed,
		},
		{
			name: "upstream non-zero code",
			client: func() *mockLLMHubRPCClient {
				c := new(mockLLMHubRPCClient)
				c.On("RuntimeGenerate", mock.Anything, mock.Anything).
					Return(&llmhubpb.RuntimeGenerateResponse{Code: 500, Msg: "model overloaded"}, nil)
				return c
			},
			req:     &dto.RuntimeGenerateRequest{Model: "gpt-4"},
			wantErr: true,
			errCode: errcode.LLMHubRuntimeFailed,
		},
		{
			name: "success with outputs and usage",
			client: func() *mockLLMHubRPCClient {
				c := new(mockLLMHubRPCClient)
				c.On("RuntimeGenerate", mock.Anything, mock.MatchedBy(
					func(req *llmhubpb.RuntimeGenerateRequest) bool {
						return req.Model == "gpt-4" && req.Instructions == "be helpful"
					},
				)).Return(&llmhubpb.RuntimeGenerateResponse{
					Outputs: []*llmhubpb.RuntimeOutputItem{
						{Type: "text", Text: "Hello world"},
					},
					Usage: &llmhubpb.RuntimeUsage{PromptTokens: 10, CompletionTokens: 5, TotalTokens: 15},
					Trace: &llmhubpb.RuntimeTrace{ProviderTemplateType: 1, Model: "gpt-4", LatencyMs: 200},
				}, nil)
				return c
			},
			req: &dto.RuntimeGenerateRequest{
				Model:        "gpt-4",
				Instructions: "be helpful",
				Inputs: []*dto.RuntimeInput{
					{Role: "user", Content: []*dto.RuntimeInputContent{{Type: "text", Text: "hi"}}},
				},
			},
			check: func(t *testing.T, resp *dto.RuntimeGenerateResponse) {
				require.Len(t, resp.Outputs, 1)
				assert.Equal(t, "text", resp.Outputs[0].Type)
				assert.Equal(t, "Hello world", resp.Outputs[0].Text)

				require.NotNil(t, resp.Usage)
				assert.Equal(t, int64(15), resp.Usage.TotalTokens)

				require.NotNil(t, resp.Trace)
				assert.Equal(t, int64(200), resp.Trace.LatencyMs)
			},
		},
		{
			name: "success with nil usage and trace",
			client: func() *mockLLMHubRPCClient {
				c := new(mockLLMHubRPCClient)
				c.On("RuntimeGenerate", mock.Anything, mock.Anything).
					Return(&llmhubpb.RuntimeGenerateResponse{
						Outputs: []*llmhubpb.RuntimeOutputItem{
							{Type: "text", Text: "ok"},
						},
					}, nil)
				return c
			},
			req: &dto.RuntimeGenerateRequest{Model: "gpt-4"},
			check: func(t *testing.T, resp *dto.RuntimeGenerateResponse) {
				assert.Nil(t, resp.Usage)
				assert.Nil(t, resp.Trace)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := &Service{}
			if tt.client != nil {
				svc.runtimeClient = tt.client()
			}

			resp, err := svc.RuntimeGenerate(context.Background(), tt.req)
			if tt.wantErr {
				require.Error(t, err)
				if tt.errCode != 0 {
					ae, ok := apperr.As(err)
					require.True(t, ok)
					assert.Equal(t, tt.errCode, ae.Code())
				}
				return
			}

			require.NoError(t, err)
			require.NotNil(t, resp)
			if tt.check != nil {
				tt.check(t, resp)
			}
		})
	}
}

// ─── RuntimeGenerateStream ──────────────────────────────────────────────────────

func TestRuntimeGenerateStream(t *testing.T) {
	tests := []struct {
		name       string
		client     func() *mockLLMHubRPCClient
		req        *dto.RuntimeGenerateRequest
		wantErr    bool
		errCode    int32
		wantChunks int
	}{
		{
			name:    "nil client returns unavailable",
			client:  nil,
			req:     &dto.RuntimeGenerateRequest{Model: "gpt-4"},
			wantErr: true,
			errCode: errcode.CommonUnavailable,
		},
		{
			name: "empty model returns invalid param",
			client: func() *mockLLMHubRPCClient {
				return new(mockLLMHubRPCClient)
			},
			req:     &dto.RuntimeGenerateRequest{Model: ""},
			wantErr: true,
			errCode: errcode.CommonInvalidParam,
		},
		{
			name: "gRPC stream open error",
			client: func() *mockLLMHubRPCClient {
				c := new(mockLLMHubRPCClient)
				c.On("RuntimeGenerateStream", mock.Anything, mock.Anything).
					Return(nil, errors.New("stream failed"))
				return c
			},
			req:     &dto.RuntimeGenerateRequest{Model: "gpt-4"},
			wantErr: true,
			errCode: errcode.LLMHubRuntimeFailed,
		},
		{
			name: "stream with recv error",
			client: func() *mockLLMHubRPCClient {
				c := new(mockLLMHubRPCClient)
				stream := &mockStreamClient{err: errors.New("broken pipe")}
				c.On("RuntimeGenerateStream", mock.Anything, mock.Anything).
					Return(grpc.ServerStreamingClient[llmhubpb.RuntimeStreamChunk](stream), nil)
				return c
			},
			req:     &dto.RuntimeGenerateRequest{Model: "gpt-4"},
			wantErr: true,
			errCode: errcode.LLMHubRuntimeFailed,
		},
		{
			name: "successful stream with multiple chunks",
			client: func() *mockLLMHubRPCClient {
				c := new(mockLLMHubRPCClient)
				stream := &mockStreamClient{
					chunks: []*llmhubpb.RuntimeStreamChunk{
						{Delta: "Hello "},
						{
							Delta: "world", FinishReason: "stop",
							Usage: &llmhubpb.RuntimeUsage{
								PromptTokens: 5, CompletionTokens: 2, TotalTokens: 7,
							},
						},
					},
				}
				c.On("RuntimeGenerateStream", mock.Anything, mock.Anything).
					Return(grpc.ServerStreamingClient[llmhubpb.RuntimeStreamChunk](stream), nil)
				return c
			},
			req:        &dto.RuntimeGenerateRequest{Model: "gpt-4"},
			wantChunks: 2,
		},
		{
			name: "empty stream (instant EOF)",
			client: func() *mockLLMHubRPCClient {
				c := new(mockLLMHubRPCClient)
				stream := &mockStreamClient{chunks: nil}
				c.On("RuntimeGenerateStream", mock.Anything, mock.Anything).
					Return(grpc.ServerStreamingClient[llmhubpb.RuntimeStreamChunk](stream), nil)
				return c
			},
			req:        &dto.RuntimeGenerateRequest{Model: "gpt-4"},
			wantChunks: 0,
		},
		{
			name: "chunk with error code is forwarded",
			client: func() *mockLLMHubRPCClient {
				c := new(mockLLMHubRPCClient)
				stream := &mockStreamClient{
					chunks: []*llmhubpb.RuntimeStreamChunk{
						{Code: 500, Msg: "upstream error"},
					},
				}
				c.On("RuntimeGenerateStream", mock.Anything, mock.Anything).
					Return(grpc.ServerStreamingClient[llmhubpb.RuntimeStreamChunk](stream), nil)
				return c
			},
			req:        &dto.RuntimeGenerateRequest{Model: "gpt-4"},
			wantChunks: 1,
		},
		{
			name: "onChunk error aborts stream",
			client: func() *mockLLMHubRPCClient {
				c := new(mockLLMHubRPCClient)
				stream := &mockStreamClient{
					chunks: []*llmhubpb.RuntimeStreamChunk{
						{Delta: "Hello"},
						{Delta: "should not reach"},
					},
				}
				c.On("RuntimeGenerateStream", mock.Anything, mock.Anything).
					Return(grpc.ServerStreamingClient[llmhubpb.RuntimeStreamChunk](stream), nil)
				return c
			},
			req:     &dto.RuntimeGenerateRequest{Model: "gpt-4"},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := &Service{}
			if tt.client != nil {
				svc.runtimeClient = tt.client()
			}

			var received []*dto.RuntimeStreamChunk
			callbackErr := errors.New("callback abort")

			onChunk := func(chunk *dto.RuntimeStreamChunk) error {
				if tt.name == "onChunk error aborts stream" && len(received) >= 1 {
					return callbackErr
				}
				received = append(received, chunk)
				return nil
			}

			err := svc.RuntimeGenerateStream(context.Background(), tt.req, onChunk)
			if tt.wantErr {
				require.Error(t, err)
				if tt.errCode != 0 {
					ae, ok := apperr.As(err)
					require.True(t, ok)
					assert.Equal(t, tt.errCode, ae.Code())
				}
				return
			}

			require.NoError(t, err)
			assert.Len(t, received, tt.wantChunks)

			if tt.wantChunks == 2 {
				assert.Equal(t, "Hello ", received[0].Delta)
				assert.Equal(t, "stop", received[1].FinishReason)
				require.NotNil(t, received[1].Usage)
				assert.Equal(t, int64(7), received[1].Usage.TotalTokens)
			}
			if tt.name == "chunk with error code is forwarded" {
				assert.Equal(t, int32(500), received[0].Code)
				assert.Equal(t, "upstream error", received[0].Msg)
			}
		})
	}
}

// ─── buildRuntimeGRPCRequest ────────────────────────────────────────────────────

func TestBuildRuntimeGRPCRequest(t *testing.T) {
	t.Run("full request with all fields", func(t *testing.T) {
		req := &dto.RuntimeGenerateRequest{
			Model:              "gpt-4",
			Instructions:       "be helpful",
			PreviousResponseId: "resp_123",
			Inputs: []*dto.RuntimeInput{
				{
					Role: "user",
					Content: []*dto.RuntimeInputContent{
						{Type: "text", Text: "hello"},
						{Type: "image", ImageBase64: "base64data", MediaType: "image/png"},
					},
				},
				{
					Role: "assistant",
					Content: []*dto.RuntimeInputContent{
						{Type: "text", Text: "Hi there!"},
					},
				},
			},
		}

		pb := buildRuntimeGRPCRequest(req, nil)

		assert.Equal(t, "gpt-4", pb.Model)
		assert.Equal(t, "be helpful", pb.Instructions)
		assert.Equal(t, "resp_123", pb.PreviousResponseId)
		require.Len(t, pb.Inputs, 2)

		assert.Equal(t, "user", pb.Inputs[0].Role)
		require.Len(t, pb.Inputs[0].Content, 2)
		assert.Equal(t, "text", pb.Inputs[0].Content[0].Type)
		assert.Equal(t, "hello", pb.Inputs[0].Content[0].Text)
		assert.Equal(t, "image", pb.Inputs[0].Content[1].Type)
		assert.Equal(t, "base64data", pb.Inputs[0].Content[1].ImageBase64)
	})

	t.Run("request with no inputs", func(t *testing.T) {
		req := &dto.RuntimeGenerateRequest{Model: "gpt-4"}
		pb := buildRuntimeGRPCRequest(req, nil)
		assert.Empty(t, pb.Inputs)
	})

	t.Run("input content fields are mapped correctly", func(t *testing.T) {
		req := &dto.RuntimeGenerateRequest{
			Model: "gpt-4",
			Inputs: []*dto.RuntimeInput{
				{
					Role: "tool",
					Content: []*dto.RuntimeInputContent{
						{
							Type: "function_result", CallId: "call_1", Name: "get_weather",
							Result: `{"temp": 20}`,
						},
					},
				},
			},
		}

		pb := buildRuntimeGRPCRequest(req, nil)
		c := pb.Inputs[0].Content[0]
		assert.Equal(t, "function_result", c.Type)
		assert.Equal(t, "call_1", c.CallId)
		assert.Equal(t, "get_weather", c.Name)
		assert.Equal(t, `{"temp": 20}`, c.Result)
	})

	t.Run("image detail is preserved", func(t *testing.T) {
		req := &dto.RuntimeGenerateRequest{
			Model: "gpt5.4",
			Inputs: []*dto.RuntimeInput{
				{
					Role: "user",
					Content: []*dto.RuntimeInputContent{
						{
							Type:      "image",
							ImageUrl:  "https://example.com/cat.png",
							FileUrl:   "https://example.com/cat.png",
							MediaType: "image/png",
							Detail:    "high",
						},
					},
				},
			},
		}

		pb := buildRuntimeGRPCRequest(req, nil)

		require.Len(t, pb.Inputs, 1)
		require.Len(t, pb.Inputs[0].Content, 1)
		assert.Equal(t, "high", pb.Inputs[0].Content[0].Detail)
		assert.Equal(t, "https://example.com/cat.png", pb.Inputs[0].Content[0].ImageUrl)
		assert.Equal(t, "https://example.com/cat.png", pb.Inputs[0].Content[0].FileUrl)
	})
}
