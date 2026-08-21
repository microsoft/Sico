package message

import (
	pb "sico-backend/internal/transport/http/dto/conversation"
)

// Message captures the stored representation used by t_message.
type (
	Message          = pb.Message
	MessageExtraInfo = pb.MessageExtraInfo
)
