package notification_test

import (
	"testing"

	pb "sico-backend/internal/transport/http/dto/notification"
)

func TestNotificationTypesExcludeRemovedDomains(t *testing.T) {
	t.Parallel()

	for value := int32(1); value <= 6; value++ {
		if name, exists := pb.NotificationType_name[value]; exists {
			t.Fatalf("removed notification type %d remains as %q", value, name)
		}
	}

	want := map[int32]string{
		7:  "NOTIFICATION_TYPE_DELIVERABLE_PUBLISHED",
		8:  "NOTIFICATION_TYPE_DW_DISMISSED",
		9:  "NOTIFICATION_TYPE_DW_REASSIGNED",
		10: "NOTIFICATION_TYPE_MEMBER_INVITATION",
		11: "NOTIFICATION_TYPE_MEMBER_REMOVED",
		12: "NOTIFICATION_TYPE_PROJECT_ROLE_CHANGED",
		13: "NOTIFICATION_TYPE_AGENT_EDITOR_ASSIGNED",
		14: "NOTIFICATION_TYPE_AGENT_EDITOR_REVOKED",
		15: "NOTIFICATION_TYPE_SCHEDULED_TASK_FINISHED",
	}
	for value, name := range want {
		if got := pb.NotificationType_name[value]; got != name {
			t.Fatalf("notification type %d = %q, want %q", value, got, name)
		}
	}
}
