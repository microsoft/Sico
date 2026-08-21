package handler

import (
	"testing"

	notificationdto "sico-backend/internal/transport/http/dto/notification"
)

func TestResolveRoleChangeNotificationType(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		roleCode string
		action   notificationdto.RoleChangeAction
		want     notificationdto.NotificationType
	}{
		{
			name:     "member assigned",
			roleCode: "project_member",
			action:   notificationdto.RoleChangeAction_ROLE_CHANGE_ACTION_ASSIGNED,
			want:     notificationdto.NotificationType_NOTIFICATION_TYPE_MEMBER_INVITATION,
		},
		{
			name:     "member removed",
			roleCode: "project_member",
			action:   notificationdto.RoleChangeAction_ROLE_CHANGE_ACTION_REMOVED,
			want:     notificationdto.NotificationType_NOTIFICATION_TYPE_MEMBER_REMOVED,
		},
		{
			name:     "admin assigned",
			roleCode: "project_admin",
			action:   notificationdto.RoleChangeAction_ROLE_CHANGE_ACTION_ASSIGNED,
			want:     notificationdto.NotificationType_NOTIFICATION_TYPE_PROJECT_ROLE_CHANGED,
		},
		{
			name:     "unsupported role",
			roleCode: "developer",
			action:   notificationdto.RoleChangeAction_ROLE_CHANGE_ACTION_ASSIGNED,
			want:     notificationdto.NotificationType_NOTIFICATION_TYPE_UNKNOWN,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := resolveRoleChangeNotificationType(test.roleCode, test.action); got != test.want {
				t.Fatalf("resolveRoleChangeNotificationType() = %v, want %v", got, test.want)
			}
		})
	}
}
