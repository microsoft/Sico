package impl

import (
	"encoding/json"
	"time"

	"sico-backend/internal/infra/sse"

	conversationdto "sico-backend/internal/transport/http/dto/conversation"
)

const (
	EventTypeDone    = "done"
	EventTypeError   = "error"
	EventTypeMessage = "message"
)

func buildDoneEvent() *sse.Event {
	data := conversationdto.TimestampedData{
		Timestamp: time.Now().UnixMilli(),
	}
	payload, _ := json.Marshal(data)
	return &sse.Event{
		Event: EventTypeDone,
		Data:  payload,
	}
}

func buildMessageEvent(message []byte) *sse.Event {
	return &sse.Event{
		Event: EventTypeMessage,
		Data:  message,
	}
}
