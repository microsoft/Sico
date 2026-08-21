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
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	conversationmodel "sico-backend/internal/biz/conversation/model"
	notificationentity "sico-backend/internal/entity/notification"
	entity "sico-backend/internal/entity/scheduledtask"
	"sico-backend/internal/infra/cron"
	emailinfra "sico-backend/internal/infra/email"
	rbacrepository "sico-backend/internal/store/rbac/repository"
	"sico-backend/internal/store/scheduledtask/repository"
	commondto "sico-backend/internal/transport/http/dto/common"
	conversationdto "sico-backend/internal/transport/http/dto/conversation"
	notificationdto "sico-backend/internal/transport/http/dto/notification"
	pb "sico-backend/internal/transport/http/dto/scheduledtask"
	"sico-backend/internal/transport/http/middleware"
	"sico-backend/pkg/jwtx"
)

type fakeRepository struct {
	repository.Repository
	created              *entity.ScheduledTask
	markedRunID          int64
	finishedRunID        int64
	finishedConversation int64
	finishedStatus       entity.RunStatus
	finishedExtraInfo    *entity.RunExtraInfo
	notificationID       int64
	notificationSentAt   int64
	pendingRuns          []*entity.Run
	taskByID             *entity.ScheduledTask
}

func (r *fakeRepository) Create(_ context.Context, task *entity.ScheduledTask) error {
	task.ID = 17
	r.created = task
	return nil
}

func (r *fakeRepository) GetForCreator(context.Context, int64, string) (*entity.ScheduledTask, error) {
	return r.taskByID, nil
}

func (r *fakeRepository) UpdateForCreator(
	_ context.Context,
	task *entity.ScheduledTask,
	creator string,
) (bool, error) {
	task.CreatorUsername = creator
	r.taskByID = task
	return true, nil
}

func (r *fakeRepository) MarkRunRunning(_ context.Context, runID int64) error {
	r.markedRunID = runID
	return nil
}

func (r *fakeRepository) FinishRun(
	_ context.Context,
	runID, conversationID int64,
	status entity.RunStatus,
	_ string,
	extraInfo *entity.RunExtraInfo,
) error {
	r.finishedRunID = runID
	r.finishedConversation = conversationID
	r.finishedStatus = status
	r.finishedExtraInfo = extraInfo
	return nil
}

func (r *fakeRepository) HeartbeatRun(context.Context, int64, int64) error { return nil }

func (r *fakeRepository) MarkNotificationSent(_ context.Context, _ int64, notificationID, sentAt int64) error {
	r.notificationID = notificationID
	r.notificationSentAt = sentAt
	return nil
}

func (r *fakeRepository) ListPendingNotifications(context.Context, int64, int) ([]*entity.Run, error) {
	return r.pendingRuns, nil
}

func (r *fakeRepository) ClaimNotification(context.Context, int64, int64, int64) (bool, error) {
	return true, nil
}

func (r *fakeRepository) ReleaseNotificationClaim(context.Context, int64, int64) error { return nil }

type fakeConversationService struct {
	validatedAgentID int64
	result           *conversationmodel.HeadlessChatResponse
	err              error
}

func (s *fakeConversationService) ValidateAgentInstanceAccess(_ context.Context, agentInstanceID int64) error {
	s.validatedAgentID = agentInstanceID
	return nil
}

func (s *fakeConversationService) RunHeadlessChat(
	context.Context,
	*conversationmodel.HeadlessChatRequest,
) (*conversationmodel.HeadlessChatResponse, error) {
	return s.result, s.err
}

type fakeNotificationService struct {
	notification *notificationentity.Notification
}

type fakeEmailClient struct {
	mail    *emailinfra.Mail
	started chan struct{}
	release chan struct{}
}

func (c *fakeEmailClient) SendMail(mail *emailinfra.Mail) error {
	c.mail = mail
	if c.started != nil {
		close(c.started)
	}
	if c.release != nil {
		<-c.release
	}
	return nil
}

type fakeUserRepository struct {
	user *rbacrepository.UserModel
}

func (r *fakeUserRepository) GetUserByUsername(context.Context, string) (*rbacrepository.UserModel, error) {
	return r.user, nil
}

func (s *fakeNotificationService) Create(
	_ context.Context,
	notification *notificationentity.Notification,
) (int64, error) {
	s.notification = notification
	return 42, nil
}

func TestCreateSanitizesAttachmentsAndUsesCreator(t *testing.T) {
	repo := new(fakeRepository)
	conversationService := new(fakeConversationService)
	service := NewService(&Components{
		Repository: repo, ConversationService: conversationService, Parser: cron.NewParser(),
	})
	ctx := context.WithValue(
		context.Background(), middleware.ContextUserKey, jwtx.UserInfo{Name: "alice"},
	)

	resp, err := service.Create(ctx, &pb.CreateScheduledTaskRequest{
		Name: " Daily report ", Enabled: false, AgentInstanceId: 23, Message: " Report status ",
		CronExpression: "0 8 * * *", Timezone: "UTC",
		Attachments: []*commondto.Attachment{{Name: "report.csv", Uri: "project/report.csv", SasUrl: "expired"}},
		ExtraInfo:   &pb.ScheduledTaskExtraInfo{SendEmailOnComplete: true},
	})

	require.NoError(t, err)
	require.Equal(t, int64(23), conversationService.validatedAgentID)
	require.Equal(t, int64(17), resp.Data.Id)
	require.Equal(t, "alice", repo.created.CreatorUsername)
	require.Equal(t, "Daily report", repo.created.Name)
	require.Equal(t, "Report status", repo.created.Message)
	require.Zero(t, repo.created.NextRunAt)
	require.Empty(t, repo.created.Attachments[0].SasUrl)
	require.True(t, repo.created.ExtraInfo.SendEmailOnComplete)
	require.True(t, resp.Data.ExtraInfo.SendEmailOnComplete)
}

func TestCreateRejectsInvalidSchedule(t *testing.T) {
	repo := new(fakeRepository)
	service := NewService(&Components{
		Repository: repo, ConversationService: new(fakeConversationService), Parser: cron.NewParser(),
	})
	ctx := context.WithValue(
		context.Background(), middleware.ContextUserKey, jwtx.UserInfo{Name: "alice"},
	)

	_, err := service.Create(ctx, &pb.CreateScheduledTaskRequest{
		Name: "task", AgentInstanceId: 23, Message: "run", CronExpression: "invalid", Timezone: "UTC",
	})

	require.Error(t, err)
	require.Nil(t, repo.created)
}

func TestUpdatePersistsSendEmailOnComplete(t *testing.T) {
	repo := &fakeRepository{taskByID: &entity.ScheduledTask{ID: 17, CreatorUsername: "alice"}}
	service := NewService(&Components{
		Repository: repo, ConversationService: new(fakeConversationService), Parser: cron.NewParser(),
	})
	ctx := context.WithValue(
		context.Background(), middleware.ContextUserKey, jwtx.UserInfo{Name: "alice"},
	)

	resp, err := service.Update(ctx, &pb.UpdateScheduledTaskRequest{
		Id: 17, Name: "Daily report", Enabled: true, AgentInstanceId: 23, Message: "Report status",
		CronExpression: "0 8 * * *", Timezone: "UTC",
		ExtraInfo: &pb.ScheduledTaskExtraInfo{SendEmailOnComplete: true},
	})

	require.NoError(t, err)
	require.True(t, repo.taskByID.ExtraInfo.SendEmailOnComplete)
	require.True(t, resp.Data.ExtraInfo.SendEmailOnComplete)
}

func TestExecuteFailureRetainsConversationID(t *testing.T) {
	repo := new(fakeRepository)
	conversationService := &fakeConversationService{
		result: &conversationmodel.HeadlessChatResponse{ConversationID: 91},
		err:    errors.New("core unavailable"),
	}
	service := NewService(&Components{Repository: repo, ConversationService: conversationService})

	service.execute(context.Background(), &entity.ScheduledTask{
		ID: 7, AgentInstanceID: 23, CreatorUsername: "alice", Message: "run",
	}, &entity.Run{ID: 8, SubmissionID: "scheduled-task:7:1"})

	require.Equal(t, int64(8), repo.markedRunID)
	require.Equal(t, int64(8), repo.finishedRunID)
	require.Equal(t, int64(91), repo.finishedConversation)
	require.Equal(t, entity.RunStatusFailed, repo.finishedStatus)
	require.Equal(t, conversationdto.PlanStatus_PLAN_STATUS_UNKNOWN, repo.finishedExtraInfo.PlanStatus)
}

func TestExecuteNotificationPreservesOriginalPlanStatus(t *testing.T) {
	repo := new(fakeRepository)
	conversationService := &fakeConversationService{result: &conversationmodel.HeadlessChatResponse{
		ConversationID: 91,
		TurnID:         1,
		PlanStatus:     conversationdto.PlanStatus_PLAN_STATUS_REQUIRE_HUMAN_INPUT,
	}}
	notificationService := new(fakeNotificationService)
	service := NewService(&Components{
		Repository: repo, ConversationService: conversationService, NotificationService: notificationService,
	})
	run := &entity.Run{
		ID: 8, ScheduledFor: 1000, SubmissionID: "scheduled-task:7:1000",
		ExtraInfo: &entity.RunExtraInfo{
			Task:             &commondto.ScheduledTaskDigest{Id: 7, Title: "Daily report"},
			ReceiverUsername: "alice",
		},
	}

	service.execute(context.Background(), &entity.ScheduledTask{
		ID: 7, AgentInstanceID: 23, CreatorUsername: "alice", Message: "run",
	}, run)

	require.Equal(t, entity.RunStatusSucceeded, repo.finishedStatus)
	require.Equal(
		t, conversationdto.PlanStatus_PLAN_STATUS_REQUIRE_HUMAN_INPUT, repo.finishedExtraInfo.PlanStatus,
	)
	require.NotNil(t, notificationService.notification)
	require.Equal(
		t,
		notificationdto.NotificationType_NOTIFICATION_TYPE_SCHEDULED_TASK_FINISHED,
		notificationService.notification.Type,
	)
	payload := notificationService.notification.ExtraInfo.GetScheduledTaskFinished()
	require.Equal(t, conversationdto.PlanStatus_PLAN_STATUS_REQUIRE_HUMAN_INPUT, payload.Status)
	require.Equal(t, int64(7), payload.Task.Id)
	require.Equal(t, "Daily report", payload.Task.Title)
	require.Equal(t, int64(8), payload.ScheduledTaskRunId)
	require.Equal(t, int64(91), payload.ConversationId)
	require.Equal(t, int64(1000), payload.ScheduledFor)
	require.Equal(t, int64(42), repo.notificationID)
	require.Positive(t, repo.notificationSentAt)
}

func TestDispatchPendingNotificationsRecoversUnsentRun(t *testing.T) {
	run := &entity.Run{
		ID: 8, ConversationID: 91, ScheduledFor: 1000, Status: entity.RunStatusSucceeded,
		ExtraInfo: &entity.RunExtraInfo{
			Task:             &commondto.ScheduledTaskDigest{Id: 7, Title: "Daily report"},
			ReceiverUsername: "alice",
			PlanStatus:       conversationdto.PlanStatus_PLAN_STATUS_NO_PLAN,
		},
	}
	repo := &fakeRepository{pendingRuns: []*entity.Run{run}}
	notificationService := new(fakeNotificationService)
	service := NewService(&Components{Repository: repo, NotificationService: notificationService})

	err := service.dispatchPendingNotifications(context.Background())

	require.NoError(t, err)
	require.Equal(
		t,
		conversationdto.PlanStatus_PLAN_STATUS_NO_PLAN,
		notificationService.notification.ExtraInfo.GetScheduledTaskFinished().Status,
	)
	require.Equal(t, int64(42), repo.notificationID)
}

func TestSendCompletionEmailUsesUserEmailAndOriginalStatus(t *testing.T) {
	emailClient := new(fakeEmailClient)
	service := NewService(&Components{
		EmailClient: emailClient,
		UserRepository: &fakeUserRepository{user: &rbacrepository.UserModel{
			Username: "alice", Email: "alice@example.com",
		}},
	})
	run := &entity.Run{
		ID:         8,
		StartedAt:  time.Date(2026, time.August, 13, 12, 30, 0, 0, time.UTC).UnixMilli(),
		FinishedAt: time.Date(2026, time.August, 13, 12, 35, 0, 0, time.UTC).UnixMilli(),
		ExtraInfo: &entity.RunExtraInfo{
			Task:                &commondto.ScheduledTaskDigest{Id: 7, Title: "Daily <report>"},
			ReceiverUsername:    "alice",
			Timezone:            "America/New_York",
			PlanStatus:          conversationdto.PlanStatus_PLAN_STATUS_REQUIRE_HUMAN_INPUT,
			SendEmailOnComplete: true,
		}}

	err := service.sendCompletionEmail(context.Background(), run, &completionEmailContext{
		digitalWorkerName: "Research <Worker>",
		response:          "Review <complete>.\nNo issues found.",
	})

	require.NoError(t, err)
	require.NotNil(t, emailClient.mail)
	require.Equal(t, "alice@example.com", emailClient.mail.Recipients.To[0].Address)
	require.Contains(t, emailClient.mail.Content.PlainText, `Your scheduled task "Daily <report>" needs human input.`)
	require.Contains(t, emailClient.mail.Content.PlainText,
		"Execution time: August 13, 2026 at 8:30 AM EDT – August 13, 2026 at 8:35 AM EDT")
	require.Contains(t, emailClient.mail.Content.PlainText, "Execution response from Research <Worker>:")
	require.Contains(t, emailClient.mail.Content.PlainText, "> Review <complete>.\n> No issues found.")
	require.Contains(t, emailClient.mail.Content.Html, "Daily &lt;report&gt;")
	require.Contains(t, emailClient.mail.Content.Html, "Research &lt;Worker&gt;")
	require.Contains(t, emailClient.mail.Content.Html, "Review &lt;complete&gt;.<br>No issues found.")
	require.Contains(t, emailClient.mail.Content.Html, "needs human input")
	require.NotContains(t, emailClient.mail.Content.Html, "Daily <report>")
}

func TestScheduledTaskCompletionPhrase(t *testing.T) {
	tests := []struct {
		name       string
		planStatus conversationdto.PlanStatus
		runStatus  entity.RunStatus
		want       string
	}{
		{
			name: "completed", planStatus: conversationdto.PlanStatus_PLAN_STATUS_COMPLETED,
			want: "has been completed successfully",
		},
		{
			name: "no plan", planStatus: conversationdto.PlanStatus_PLAN_STATUS_NO_PLAN,
			want: "has been completed successfully",
		},
		{name: "failed", planStatus: conversationdto.PlanStatus_PLAN_STATUS_FAILED, want: "has failed"},
		{
			name: "human input", planStatus: conversationdto.PlanStatus_PLAN_STATUS_REQUIRE_HUMAN_INPUT,
			want: "needs human input",
		},
		{name: "cancelled", planStatus: conversationdto.PlanStatus_PLAN_STATUS_CANCELLED, want: "has been cancelled"},
		{name: "transport failure", runStatus: entity.RunStatusFailed, want: "has failed"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			require.Equal(t, test.want, scheduledTaskCompletionPhrase(test.planStatus, test.runStatus))
		})
	}
}

func TestCompletionEmailIsNonBlocking(t *testing.T) {
	emailClient := &fakeEmailClient{started: make(chan struct{}), release: make(chan struct{})}
	service := NewService(&Components{
		EmailClient: emailClient,
		UserRepository: &fakeUserRepository{user: &rbacrepository.UserModel{
			Username: "alice", Email: "alice@example.com",
		}},
	})
	run := &entity.Run{ID: 8, ExtraInfo: &entity.RunExtraInfo{
		Task:                &commondto.ScheduledTaskDigest{Id: 7, Title: "Daily report"},
		ReceiverUsername:    "alice",
		PlanStatus:          conversationdto.PlanStatus_PLAN_STATUS_COMPLETED,
		SendEmailOnComplete: true,
	}}

	returned := make(chan struct{})
	go func() {
		service.sendCompletionEmailBestEffort(context.Background(), run, nil)
		close(returned)
	}()

	select {
	case <-returned:
	case <-time.After(time.Second):
		t.Fatal("best-effort email dispatch blocked completion logic")
	}
	select {
	case <-emailClient.started:
	case <-time.After(time.Second):
		t.Fatal("email send did not start")
	}
	close(emailClient.release)
}
