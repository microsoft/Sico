package impl

import (
	"context"
	"encoding/json"

	"gorm.io/gorm"
)

// taskRuntimeBatchListRow is a read-only GORM mapping for t_task_runtime_batch
// used by the conversation batch-summary listing endpoint.
type taskRuntimeBatchListRow struct {
	BatchID              string  `gorm:"column:batch_id"`
	ParentConversationID int64   `gorm:"column:parent_conversation_id"`
	ParentTurnID         int64   `gorm:"column:parent_turn_id"`
	Status               string  `gorm:"column:status"`
	Reason               string  `gorm:"column:reason"`
	TotalCount           int32   `gorm:"column:total_count"`
	BatchJSON            string  `gorm:"column:batch_json"`
	CreatedAt            uint64  `gorm:"column:created_at"`
	UpdatedAt            uint64  `gorm:"column:updated_at"`
	EndedAt              *uint64 `gorm:"column:ended_at"`
}

func (taskRuntimeBatchListRow) TableName() string { return "t_task_runtime_batch" }

// listBatchSummariesFilter narrows the t_task_runtime_batch read for one
// conversation.
type listBatchSummariesFilter struct {
	ConversationID int64
	TurnID         *int64
	Limit          int
	Offset         int
}

func listBatchSummaries(
	ctx context.Context,
	db *gorm.DB,
	filter listBatchSummariesFilter,
) ([]taskRuntimeBatchListRow, error) {
	q := db.WithContext(ctx).
		Model(&taskRuntimeBatchListRow{}).
		Where("parent_conversation_id = ?", filter.ConversationID)
	if filter.TurnID != nil {
		q = q.Where("parent_turn_id = ?", *filter.TurnID)
	}
	rows := make([]taskRuntimeBatchListRow, 0, filter.Limit+1)
	if err := q.Order("id DESC").Limit(filter.Limit + 1).Offset(filter.Offset).Find(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

// extractSummaryURI parses the BatchRecord JSON and returns the top-level
// ``summary_uri`` string. Missing or invalid payloads return "" — they should
// not break the HTTP listing response.
func extractSummaryURI(batchJSON string) string {
	if batchJSON == "" {
		return ""
	}
	var payload struct {
		SummaryURI string `json:"summary_uri"`
	}
	if err := json.Unmarshal([]byte(batchJSON), &payload); err != nil {
		return ""
	}
	return payload.SummaryURI
}
