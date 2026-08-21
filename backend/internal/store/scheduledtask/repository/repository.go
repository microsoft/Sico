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

package repository

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"gorm.io/datatypes"
	"gorm.io/gorm"

	entity "sico-backend/internal/entity/scheduledtask"
)

type Repository interface {
	Create(ctx context.Context, task *entity.ScheduledTask) error
	Get(ctx context.Context, id int64) (*entity.ScheduledTask, error)
	GetForCreator(ctx context.Context, id int64, creator string) (*entity.ScheduledTask, error)
	UpdateForCreator(ctx context.Context, task *entity.ScheduledTask, creator string) (bool, error)
	DeleteForCreator(ctx context.Context, id int64, creator string) (bool, error)
	ListForCreator(ctx context.Context, creator string, offset, limit int) ([]*entity.ScheduledTask, int64, error)
	ListDue(ctx context.Context, now int64, limit int) ([]*entity.ScheduledTask, error)
	Claim(
		ctx context.Context,
		taskID, scheduledFor, nextRunAt int64,
		submissionID string,
		extraInfo *entity.RunExtraInfo,
	) (*entity.Run, bool, error)
	MarkRunRunning(ctx context.Context, runID int64) error
	HeartbeatRun(ctx context.Context, runID, leaseExpiresAt int64) error
	FinishRun(
		ctx context.Context,
		runID, conversationID int64,
		status entity.RunStatus,
		errorMessage string,
		extraInfo *entity.RunExtraInfo,
	) error
	ListPendingNotifications(ctx context.Context, staleBefore int64, limit int) ([]*entity.Run, error)
	ClaimNotification(ctx context.Context, runID, claimedAt, staleBefore int64) (bool, error)
	ReleaseNotificationClaim(ctx context.Context, runID, claimedAt int64) error
	MarkNotificationSent(ctx context.Context, runID, notificationID, sentAt int64) error
}

type repository struct{ db *gorm.DB }

func NewRepository(db *gorm.DB) Repository { return &repository{db: db} }

func (r *repository) Create(ctx context.Context, task *entity.ScheduledTask) error {
	return r.db.WithContext(ctx).Create(task).Error
}

func (r *repository) Get(ctx context.Context, id int64) (*entity.ScheduledTask, error) {
	var task entity.ScheduledTask
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&task).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &task, err
}

func (r *repository) GetForCreator(ctx context.Context, id int64, creator string) (*entity.ScheduledTask, error) {
	var task entity.ScheduledTask
	err := r.db.WithContext(ctx).Where("id = ? AND creator_username = ?", id, creator).First(&task).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &task, err
}

func (r *repository) UpdateForCreator(
	ctx context.Context,
	task *entity.ScheduledTask,
	creator string,
) (bool, error) {
	attachments, err := marshalTaskAttachments(task.Attachments)
	if err != nil {
		return false, err
	}
	extraInfo, err := marshalTaskExtraInfo(task.ExtraInfo)
	if err != nil {
		return false, err
	}
	result := r.db.WithContext(ctx).Model(&entity.ScheduledTask{}).
		Where("id = ? AND creator_username = ?", task.ID, creator).
		Updates(map[string]any{
			"name": task.Name, "enabled": task.Enabled, "agent_instance_id": task.AgentInstanceID,
			"message": task.Message, "attachments": attachments, "extra_info": extraInfo,
			"cron_expression": task.CronExpression,
			"timezone":        task.Timezone, "next_run_at": task.NextRunAt,
		})
	return result.RowsAffected > 0, result.Error
}

func marshalTaskAttachments(attachments any) (datatypes.JSON, error) {
	payload, err := json.Marshal(attachments)
	if err != nil {
		return nil, err
	}
	return datatypes.JSON(payload), nil
}

func marshalTaskExtraInfo(extraInfo any) (datatypes.JSON, error) {
	if extraInfo == nil {
		return nil, nil
	}
	payload, err := json.Marshal(extraInfo)
	if err != nil {
		return nil, err
	}
	return datatypes.JSON(payload), nil
}

func (r *repository) DeleteForCreator(ctx context.Context, id int64, creator string) (bool, error) {
	result := r.db.WithContext(ctx).Where("id = ? AND creator_username = ?", id, creator).
		Delete(&entity.ScheduledTask{})
	return result.RowsAffected > 0, result.Error
}

func (r *repository) ListForCreator(
	ctx context.Context,
	creator string,
	offset, limit int,
) ([]*entity.ScheduledTask, int64, error) {
	query := r.db.WithContext(ctx).Model(&entity.ScheduledTask{}).Where("creator_username = ?", creator)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var tasks []*entity.ScheduledTask
	err := query.Order("created_at DESC").Offset(offset).Limit(limit).Find(&tasks).Error
	return tasks, total, err
}

func (r *repository) ListDue(ctx context.Context, now int64, limit int) ([]*entity.ScheduledTask, error) {
	var tasks []*entity.ScheduledTask
	err := r.db.WithContext(ctx).Where("enabled = ? AND next_run_at > 0 AND next_run_at <= ?", true, now).
		Order("next_run_at ASC").Limit(limit).Find(&tasks).Error
	return tasks, err
}

func (r *repository) Claim(
	ctx context.Context,
	taskID, scheduledFor, nextRunAt int64,
	submissionID string,
	extraInfo *entity.RunExtraInfo,
) (*entity.Run, bool, error) {
	run := &entity.Run{
		ScheduledTaskID: taskID,
		ScheduledFor:    scheduledFor,
		Status:          entity.RunStatusClaimed,
		SubmissionID:    submissionID,
		ExtraInfo:       extraInfo,
		LeaseExpiresAt:  unixMilli() + int64((2*time.Minute)/time.Millisecond),
	}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		now := unixMilli()
		if err := tx.Model(&entity.Run{}).
			Where("scheduled_task_id = ? AND status IN ? AND lease_expires_at <= ?", taskID, []entity.RunStatus{
				entity.RunStatusClaimed, entity.RunStatusRunning,
			}, now).
			Updates(map[string]any{
				"status": entity.RunStatusFailed, "error_message": "worker lease expired", "finished_at": now,
			}).Error; err != nil {
			return err
		}
		var activeRuns int64
		if err := tx.Model(&entity.Run{}).
			Where("scheduled_task_id = ? AND status IN ?", taskID, []entity.RunStatus{
				entity.RunStatusClaimed, entity.RunStatusRunning,
			}).Count(&activeRuns).Error; err != nil {
			return err
		}
		if activeRuns > 0 {
			return errRunActive
		}
		result := tx.Model(&entity.ScheduledTask{}).
			Where("id = ? AND enabled = ? AND next_run_at = ?", taskID, true, scheduledFor).
			Updates(map[string]any{"last_run_at": scheduledFor, "next_run_at": nextRunAt})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return errClaimLost
		}
		return tx.Create(run).Error
	})
	if errors.Is(err, errClaimLost) || errors.Is(err, errRunActive) || errors.Is(err, gorm.ErrDuplicatedKey) {
		return nil, false, nil
	}
	return run, err == nil, err
}

func (r *repository) MarkRunRunning(ctx context.Context, runID int64) error {
	return r.db.WithContext(ctx).Model(&entity.Run{}).Where("id = ?", runID).
		Updates(map[string]any{"status": entity.RunStatusRunning, "started_at": unixMilli()}).Error
}

func (r *repository) HeartbeatRun(ctx context.Context, runID, leaseExpiresAt int64) error {
	return r.db.WithContext(ctx).Model(&entity.Run{}).
		Where("id = ? AND status = ?", runID, entity.RunStatusRunning).
		Update("lease_expires_at", leaseExpiresAt).Error
}

func (r *repository) FinishRun(
	ctx context.Context,
	runID, conversationID int64,
	status entity.RunStatus,
	errorMessage string,
	extraInfo *entity.RunExtraInfo,
) error {
	updates := map[string]any{
		"status": status, "conversation_id": conversationID, "error_message": errorMessage,
		"finished_at": unixMilli(),
	}
	if extraInfo != nil {
		payload, err := json.Marshal(extraInfo)
		if err != nil {
			return err
		}
		updates["extra_info"] = datatypes.JSON(payload)
	}
	return r.db.WithContext(ctx).Model(&entity.Run{}).Where("id = ?", runID).Updates(updates).Error
}

func (r *repository) ListPendingNotifications(ctx context.Context, staleBefore int64, limit int) ([]*entity.Run, error) {
	var runs []*entity.Run
	err := r.db.WithContext(ctx).
		Where("status IN ?", []entity.RunStatus{entity.RunStatusSucceeded, entity.RunStatusFailed}).
		Where(
			"notification_sent_at = 0 OR (notification_sent_at <= ? AND "+
				"COALESCE(JSON_EXTRACT(extra_info, '$.notificationId'), 0) = 0)",
			staleBefore,
		).
		Order("finished_at ASC").Limit(limit).Find(&runs).Error
	return runs, err
}

func (r *repository) ClaimNotification(ctx context.Context, runID, claimedAt, staleBefore int64) (bool, error) {
	result := r.db.WithContext(ctx).Model(&entity.Run{}).
		Where("id = ? AND status IN ?", runID, []entity.RunStatus{
			entity.RunStatusSucceeded, entity.RunStatusFailed,
		}).
		Where(
			"notification_sent_at = 0 OR (notification_sent_at <= ? AND "+
				"COALESCE(JSON_EXTRACT(extra_info, '$.notificationId'), 0) = 0)",
			staleBefore,
		).
		Update("notification_sent_at", claimedAt)
	return result.RowsAffected > 0, result.Error
}

func (r *repository) ReleaseNotificationClaim(ctx context.Context, runID, claimedAt int64) error {
	return r.db.WithContext(ctx).Model(&entity.Run{}).
		Where("id = ? AND notification_sent_at = ?", runID, claimedAt).
		Update("notification_sent_at", 0).Error
}

func (r *repository) MarkNotificationSent(ctx context.Context, runID, notificationID, sentAt int64) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var run entity.Run
		if err := tx.Where("id = ?", runID).First(&run).Error; err != nil {
			return err
		}
		if run.ExtraInfo == nil {
			run.ExtraInfo = new(entity.RunExtraInfo)
		}
		run.ExtraInfo.NotificationID = notificationID
		payload, err := json.Marshal(run.ExtraInfo)
		if err != nil {
			return err
		}
		return tx.Model(&entity.Run{}).Where("id = ?", runID).
			Updates(map[string]any{
				"extra_info": datatypes.JSON(payload), "notification_sent_at": sentAt,
			}).Error
	})
}
