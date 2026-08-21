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
	"fmt"
	"strings"
	"time"

	appresp "sico-backend/internal/biz/common/response"
	conversationmodel "sico-backend/internal/biz/conversation/model"
	notificationentity "sico-backend/internal/entity/notification"
	entity "sico-backend/internal/entity/scheduledtask"
	"sico-backend/internal/infra/cron"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/errcode"
	"sico-backend/internal/store/scheduledtask/repository"
	commondto "sico-backend/internal/transport/http/dto/common"
	conversationdto "sico-backend/internal/transport/http/dto/conversation"
	notificationdto "sico-backend/internal/transport/http/dto/notification"
	pb "sico-backend/internal/transport/http/dto/scheduledtask"
	"sico-backend/internal/transport/http/middleware"
	"sico-backend/pkg/jwtx"
	"sico-backend/pkg/logger"
	"sico-backend/pkg/safego"
)

const (
	pollInterval              = 10 * time.Second
	heartbeatInterval         = 30 * time.Second
	runLeaseDuration          = 2 * time.Minute
	notificationClaimDuration = 2 * time.Minute
	dueBatchSize              = 100
	notificationBatchSize     = 100
)

type Components struct {
	Repository          repository.Repository
	ConversationService ConversationService
	NotificationService NotificationService
	EmailClient         EmailClient
	UserRepository      UserRepository
	DeliverableStorage  DeliverableStorage
	Cron                cron.Cron
	Parser              cron.Parser
}

type NotificationService interface {
	Create(ctx context.Context, notification *notificationentity.Notification) (int64, error)
}

type ConversationService interface {
	ValidateAgentInstanceAccess(ctx context.Context, agentInstanceID int64) error
	RunHeadlessChat(
		ctx context.Context,
		req *conversationmodel.HeadlessChatRequest,
	) (*conversationmodel.HeadlessChatResponse, error)
}

type Service struct{ *Components }

func NewService(components *Components) *Service { return &Service{Components: components} }

func (s *Service) Create(
	ctx context.Context,
	req *pb.CreateScheduledTaskRequest,
) (*pb.CreateScheduledTaskResponse, error) {
	username := middleware.MustGetUsernameFromCtx(ctx)
	name, message, nextRunAt, err := s.validateAndNext(
		ctx, req.Name, req.Message, req.AgentInstanceId, req.CronExpression, req.Timezone,
	)
	if err != nil {
		return nil, err
	}
	task := &entity.ScheduledTask{
		Name: name, Enabled: req.Enabled, AgentInstanceID: req.AgentInstanceId, CreatorUsername: username,
		Message:        message,
		Attachments:    normalizeAttachments(req.Attachments),
		ExtraInfo:      normalizeTaskExtraInfo(req.ExtraInfo),
		CronExpression: strings.TrimSpace(req.CronExpression),
		Timezone:       strings.TrimSpace(req.Timezone),
		NextRunAt:      nextRunAt,
	}
	if !task.Enabled {
		task.NextRunAt = 0
	}
	if err := s.Repository.Create(ctx, task); err != nil {
		return nil, err
	}
	return appresp.Success(&pb.CreateScheduledTaskResponse{Data: taskToDTO(task)}), nil
}

func (s *Service) Get(
	ctx context.Context,
	req *pb.GetScheduledTaskRequest,
) (*pb.GetScheduledTaskResponse, error) {
	task, err := s.ownedTask(ctx, req.Id)
	if err != nil {
		return nil, err
	}
	return appresp.Success(&pb.GetScheduledTaskResponse{Data: taskToDTO(task)}), nil
}

func (s *Service) Update(
	ctx context.Context,
	req *pb.UpdateScheduledTaskRequest,
) (*pb.UpdateScheduledTaskResponse, error) {
	username := middleware.MustGetUsernameFromCtx(ctx)
	if _, err := s.ownedTask(ctx, req.Id); err != nil {
		return nil, err
	}
	name, message, nextRunAt, err := s.validateAndNext(
		ctx, req.Name, req.Message, req.AgentInstanceId, req.CronExpression, req.Timezone,
	)
	if err != nil {
		return nil, err
	}
	task := &entity.ScheduledTask{
		ID: req.Id, Name: name, Enabled: req.Enabled, AgentInstanceID: req.AgentInstanceId,
		Message:        message,
		Attachments:    normalizeAttachments(req.Attachments),
		ExtraInfo:      normalizeTaskExtraInfo(req.ExtraInfo),
		CronExpression: strings.TrimSpace(req.CronExpression),
		Timezone:       strings.TrimSpace(req.Timezone), NextRunAt: nextRunAt,
	}
	if !task.Enabled {
		task.NextRunAt = 0
	}
	updated, err := s.Repository.UpdateForCreator(ctx, task, username)
	if err != nil {
		return nil, err
	}
	if !updated {
		return nil, apperr.New(errcode.CommonNotFound, "scheduled task not found")
	}
	task, err = s.Repository.GetForCreator(ctx, req.Id, username)
	if err != nil {
		return nil, err
	}
	return appresp.Success(&pb.UpdateScheduledTaskResponse{Data: taskToDTO(task)}), nil
}

func (s *Service) Delete(
	ctx context.Context,
	req *pb.DeleteScheduledTaskRequest,
) (*pb.DeleteScheduledTaskResponse, error) {
	deleted, err := s.Repository.DeleteForCreator(ctx, req.Id, middleware.MustGetUsernameFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	if !deleted {
		return nil, apperr.New(errcode.CommonNotFound, "scheduled task not found")
	}
	return appresp.Success(&pb.DeleteScheduledTaskResponse{}), nil
}

func (s *Service) List(
	ctx context.Context,
	req *pb.ListScheduledTasksRequest,
) (*pb.ListScheduledTasksResponse, error) {
	offset := int(req.Page-1) * int(req.PageSize)
	tasks, total, err := s.Repository.ListForCreator(
		ctx, middleware.MustGetUsernameFromCtx(ctx), offset, int(req.PageSize),
	)
	if err != nil {
		return nil, err
	}
	items := make([]*pb.ScheduledTask, 0, len(tasks))
	for _, task := range tasks {
		items = append(items, taskToDTO(task))
	}
	return appresp.Success(&pb.ListScheduledTasksResponse{Data: &pb.ListScheduledTasksData{
		Tasks: items, Total: total, HasNext: int64(offset+int(req.PageSize)) < total,
	}}), nil
}

func (s *Service) Start(ctx context.Context) error {
	if err := s.poll(ctx); err != nil {
		logger.CtxError(ctx, "initial scheduled task poll failed: %v", err)
	}
	_, err := s.Cron.Every(pollInterval, s.poll)
	return err
}

func (s *Service) poll(ctx context.Context) error {
	if err := s.dispatchPendingNotifications(ctx); err != nil {
		logger.CtxError(ctx, "scheduled task notification recovery failed: %v", err)
	}
	now := time.Now()
	tasks, err := s.Repository.ListDue(ctx, now.UnixMilli(), dueBatchSize)
	if err != nil {
		return err
	}
	for _, task := range tasks {
		schedule, parseErr := s.Parser.Parse(task.CronExpression, task.Timezone)
		if parseErr != nil {
			logger.CtxError(ctx, "scheduled task has invalid schedule id=%d err=%v", task.ID, parseErr)
			continue
		}
		scheduledFor := task.NextRunAt
		nextRunAt := schedule.Next(now).UnixMilli()
		submissionID := fmt.Sprintf("scheduled-task:%d:%d", task.ID, scheduledFor)
		run, claimed, claimErr := s.Repository.Claim(
			ctx,
			task.ID,
			scheduledFor,
			nextRunAt,
			submissionID,
			&entity.RunExtraInfo{
				Task:                &commondto.ScheduledTaskDigest{Id: task.ID, Title: task.Name},
				ReceiverUsername:    task.CreatorUsername,
				Timezone:            task.Timezone,
				PlanStatus:          conversationdto.PlanStatus_PLAN_STATUS_UNKNOWN,
				SendEmailOnComplete: task.ExtraInfo.GetSendEmailOnComplete(),
			},
		)
		if claimErr != nil {
			logger.CtxError(ctx, "scheduled task claim failed id=%d err=%v", task.ID, claimErr)
			continue
		}
		if claimed {
			safego.Go(ctx, func() { s.execute(ctx, task, run) })
		}
	}
	return nil
}

func (s *Service) execute(ctx context.Context, task *entity.ScheduledTask, run *entity.Run) {
	executionCtx := context.WithValue(ctx, middleware.ContextUserKey, jwtx.UserInfo{Name: task.CreatorUsername})
	run.StartedAt = time.Now().UnixMilli()
	if err := s.Repository.MarkRunRunning(executionCtx, run.ID); err != nil {
		logger.CtxError(executionCtx, "scheduled task run start failed runId=%d err=%v", run.ID, err)
		if finishErr := s.finishRun(
			executionCtx,
			run,
			0,
			entity.RunStatusFailed,
			err.Error(),
			conversationdto.PlanStatus_PLAN_STATUS_UNKNOWN,
			nil,
		); finishErr != nil {
			logger.CtxError(
				executionCtx,
				"scheduled task run start failure persist failed runId=%d err=%v",
				run.ID,
				finishErr,
			)
		}
		return
	}
	heartbeatCtx, stopHeartbeat := context.WithCancel(executionCtx)
	defer stopHeartbeat()
	safego.Go(heartbeatCtx, func() { s.heartbeat(heartbeatCtx, run.ID) })
	result, err := s.ConversationService.RunHeadlessChat(executionCtx, &conversationmodel.HeadlessChatRequest{
		AgentInstanceID:    task.AgentInstanceID,
		Message:            task.Message,
		Attachments:        task.Attachments,
		SubmissionID:       run.SubmissionID,
		ScheduledTaskID:    task.ID,
		ScheduledTaskRunID: run.ID,
	})
	conversationID := int64(0)
	if result != nil {
		conversationID = result.ConversationID
	}
	if err != nil {
		if finishErr := s.finishRun(
			executionCtx,
			run,
			conversationID,
			entity.RunStatusFailed,
			err.Error(),
			resultPlanStatus(result),
			completionEmailContextFromResult(result),
		); finishErr != nil {
			logger.CtxError(
				executionCtx, "scheduled task run failure persist failed runId=%d err=%v", run.ID, finishErr,
			)
		}
		return
	}
	if err := s.finishRun(
		executionCtx,
		run,
		result.ConversationID,
		entity.RunStatusSucceeded,
		"",
		result.PlanStatus,
		completionEmailContextFromResult(result),
	); err != nil {
		logger.CtxError(executionCtx, "scheduled task run completion persist failed runId=%d err=%v", run.ID, err)
	}
}

func (s *Service) finishRun(
	ctx context.Context,
	run *entity.Run,
	conversationID int64,
	status entity.RunStatus,
	errorMessage string,
	planStatus conversationdto.PlanStatus,
	emailContext *completionEmailContext,
) error {
	run.FinishedAt = time.Now().UnixMilli()
	if run.ExtraInfo == nil {
		run.ExtraInfo = new(entity.RunExtraInfo)
	}
	run.ExtraInfo.PlanStatus = planStatus
	if err := s.Repository.FinishRun(
		ctx, run.ID, conversationID, status, errorMessage, run.ExtraInfo,
	); err != nil {
		return err
	}
	run.Status = status
	run.ConversationID = conversationID
	run.ErrorMessage = errorMessage
	s.sendCompletionEmailBestEffort(ctx, run, emailContext)
	return s.dispatchNotification(ctx, run)
}

func (s *Service) sendCompletionEmailBestEffort(
	ctx context.Context,
	run *entity.Run,
	emailContext *completionEmailContext,
) {
	if run == nil || run.ExtraInfo == nil || !run.ExtraInfo.SendEmailOnComplete {
		return
	}
	emailCtx := context.WithoutCancel(ctx)
	safego.Go(emailCtx, func() {
		if err := s.sendCompletionEmail(emailCtx, run, emailContext); err != nil {
			logger.CtxError(emailCtx, "scheduled task completion email failed runId=%d err=%v", run.ID, err)
		}
	})
}

func (s *Service) dispatchPendingNotifications(ctx context.Context) error {
	staleBefore := time.Now().Add(-notificationClaimDuration).UnixMilli()
	runs, err := s.Repository.ListPendingNotifications(ctx, staleBefore, notificationBatchSize)
	if err != nil {
		return err
	}
	for _, run := range runs {
		if err := s.dispatchNotification(ctx, run); err != nil {
			logger.CtxError(ctx, "scheduled task notification failed runId=%d err=%v", run.ID, err)
		}
	}
	return nil
}

func (s *Service) dispatchNotification(ctx context.Context, run *entity.Run) error {
	if run == nil || run.ExtraInfo == nil || run.ExtraInfo.Task == nil || run.ExtraInfo.NotificationID != 0 {
		return nil
	}
	claimedAt := time.Now().UnixMilli()
	staleBefore := time.Now().Add(-notificationClaimDuration).UnixMilli()
	claimed, err := s.Repository.ClaimNotification(ctx, run.ID, claimedAt, staleBefore)
	if err != nil {
		return err
	}
	if !claimed {
		return nil
	}
	notificationID, err := s.NotificationService.Create(ctx, &notificationentity.Notification{
		SenderUsername:   "SYSTEM",
		ReceiverUsername: run.ExtraInfo.ReceiverUsername,
		Type:             notificationdto.NotificationType_NOTIFICATION_TYPE_SCHEDULED_TASK_FINISHED,
		Status:           notificationdto.NotificationStatus_NOTIFICATION_STATUS_UNREAD,
		Content:          run.ExtraInfo.Task.GetTitle(),
		ExtraInfo: &notificationdto.NotificationExtraInfo{
			ScheduledTaskFinished: &notificationdto.NotificationExtraInfoScheduledTaskFinished{
				Task:               run.ExtraInfo.Task,
				Status:             run.ExtraInfo.PlanStatus,
				ScheduledTaskRunId: run.ID,
				ConversationId:     run.ConversationID,
				ScheduledFor:       run.ScheduledFor,
			},
		},
	})
	if err != nil {
		if releaseErr := s.Repository.ReleaseNotificationClaim(ctx, run.ID, claimedAt); releaseErr != nil {
			logger.CtxError(
				ctx, "scheduled task notification claim release failed runId=%d err=%v", run.ID, releaseErr,
			)
		}
		return err
	}
	sentAt := time.Now().UnixMilli()
	if err := s.Repository.MarkNotificationSent(ctx, run.ID, notificationID, sentAt); err != nil {
		return err
	}
	run.ExtraInfo.NotificationID = notificationID
	run.NotificationSentAt = sentAt
	return nil
}

func resultPlanStatus(result *conversationmodel.HeadlessChatResponse) conversationdto.PlanStatus {
	if result == nil {
		return conversationdto.PlanStatus_PLAN_STATUS_UNKNOWN
	}
	return result.PlanStatus
}

func completionEmailContextFromResult(result *conversationmodel.HeadlessChatResponse) *completionEmailContext {
	if result == nil {
		return nil
	}
	return &completionEmailContext{
		plan:              result.Plan,
		digitalWorkerName: result.DigitalWorkerName,
		response:          result.FinalResponse,
	}
}

func (s *Service) heartbeat(ctx context.Context, runID int64) {
	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			leaseExpiresAt := time.Now().Add(runLeaseDuration).UnixMilli()
			if err := s.Repository.HeartbeatRun(ctx, runID, leaseExpiresAt); err != nil {
				logger.CtxError(ctx, "scheduled task run heartbeat failed runId=%d err=%v", runID, err)
			}
		case <-ctx.Done():
			return
		}
	}
}

func (s *Service) validateAndNext(
	ctx context.Context,
	name, message string,
	agentInstanceID int64,
	expression, timezone string,
) (string, string, int64, error) {
	name = strings.TrimSpace(name)
	message = strings.TrimSpace(message)
	if name == "" || message == "" {
		return "", "", 0, apperr.New(errcode.CommonInvalidParam, "name and message are required")
	}
	if err := s.ConversationService.ValidateAgentInstanceAccess(ctx, agentInstanceID); err != nil {
		return "", "", 0, err
	}
	schedule, err := s.Parser.Parse(expression, timezone)
	if err != nil {
		return "", "", 0, apperr.New(errcode.CommonInvalidParam, err.Error())
	}
	return name, message, schedule.Next(time.Now()).UnixMilli(), nil
}

func (s *Service) ownedTask(ctx context.Context, id int64) (*entity.ScheduledTask, error) {
	task, err := s.Repository.GetForCreator(ctx, id, middleware.MustGetUsernameFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	if task == nil {
		return nil, apperr.New(errcode.CommonNotFound, "scheduled task not found")
	}
	return task, nil
}

func taskToDTO(task *entity.ScheduledTask) *pb.ScheduledTask {
	return &pb.ScheduledTask{
		Id:              task.ID,
		Name:            task.Name,
		Enabled:         task.Enabled,
		AgentInstanceId: task.AgentInstanceID,
		CreatorUsername: task.CreatorUsername,
		Message:         task.Message,
		Attachments:     task.Attachments,
		CronExpression:  task.CronExpression,
		Timezone:        task.Timezone,
		NextRunAt:       task.NextRunAt,
		LastRunAt:       task.LastRunAt,
		CreatedAt:       task.CreatedAt,
		UpdatedAt:       task.UpdatedAt,
		ExtraInfo:       task.ExtraInfo,
	}
}

func normalizeTaskExtraInfo(extraInfo *pb.ScheduledTaskExtraInfo) *pb.ScheduledTaskExtraInfo {
	if extraInfo == nil {
		return nil
	}
	return &pb.ScheduledTaskExtraInfo{SendEmailOnComplete: extraInfo.GetSendEmailOnComplete()}
}

func normalizeAttachments(attachments []*commondto.Attachment) []*commondto.Attachment {
	result := make([]*commondto.Attachment, 0, len(attachments))
	for _, attachment := range attachments {
		if attachment == nil {
			continue
		}
		result = append(result, &commondto.Attachment{
			Name: attachment.GetName(),
			Uri:  attachment.GetUri(),
			Type: attachment.GetType(),
			Size: attachment.GetSize(),
			Id:   attachment.GetId(),
		})
	}
	return result
}
