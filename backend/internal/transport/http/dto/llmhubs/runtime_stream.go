package llmhubs

// RuntimeStreamChunk is the SSE event payload for streaming runtime generation.
type RuntimeStreamChunk struct {
	Delta        string             `json:"delta,omitempty"`
	Outputs      []*RuntimeOutputItem `json:"outputs,omitempty"`
	FinishReason string             `json:"finish_reason,omitempty"`
	Usage        *RuntimeUsage      `json:"usage,omitempty"`
	Code         int32              `json:"code,omitempty"`
	Msg          string             `json:"msg,omitempty"`
}
