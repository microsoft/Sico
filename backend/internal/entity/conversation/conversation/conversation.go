package conversation

import conversationdto "sico-backend/internal/transport/http/dto/conversation"

type Conversation struct {
	ID              int64                                  `json:"id"`
	Title           string                                 `json:"title"`
	Status          int32                                  `json:"status"`
	AgentID         string                                 `json:"agent_id"`
	AgentInstanceID int64                                  `json:"agent_instance_id"`
	CreatorUsername string                                 `json:"creator_username"`
	Ext             string                                 `json:"ext"`
	ExtraInfo       *conversationdto.ConversationExtraInfo `json:"extra_info"`
	CreatedAt       int64                                  `json:"created_at"`
	UpdatedAt       int64                                  `json:"updated_at"`
}
