package impl

import (
	"context"
)

func (s *Service) canReadAllConversations(ctx context.Context) bool {
	access := s.rbacAccess()
	return access.Initialized() && access.IsPlatformAdmin(ctx)
}

func (s *Service) conversationReadQueryUsername(ctx context.Context, username string) string {
	if s.canReadAllConversations(ctx) {
		return ""
	}
	return username
}

func (s *Service) canReadConversation(ctx context.Context, username, creatorUsername string) bool {
	return username == creatorUsername || s.canReadAllConversations(ctx)
}
