package dal

import (
	"context"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	drivermysql "github.com/go-sql-driver/mysql"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

func TestUpdateBatchRetryReturnsOnlyCommittedAttemptState(t *testing.T) {
	db, mock, cleanup := newTaskRuntimeMockDB(t)
	defer cleanup()
	dao := NewTaskRuntimeDAO(db)
	incoming := `{"batch_id":"batch-1","parent_conversation_id":1,"parent_turn_id":2,` +
		`"status":"completed","total_count":1,"created_at":10,"updated_at":20}`

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT .*t_task_runtime_batch.*FOR UPDATE").
		WithArgs("batch-1", 1).
		WillReturnRows(batchRows(statusRunning, incoming))
	mock.ExpectExec("UPDATE .*t_task_runtime_batch.*").
		WillReturnError(&drivermysql.MySQLError{Number: mysqlDeadlockErrNum, Message: "deadlock"})
	mock.ExpectRollback()

	cancelled := `{"batch_id":"batch-1","parent_conversation_id":1,"parent_turn_id":2,` +
		`"status":"cancelled","total_count":1,"created_at":10,"updated_at":30}`
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT .*t_task_runtime_batch.*FOR UPDATE").
		WithArgs("batch-1", 1).
		WillReturnRows(batchRows(statusCancelled, cancelled))
	mock.ExpectCommit()

	result, err := dao.UpdateBatch(context.Background(), incoming)
	if err != nil {
		t.Fatalf("UpdateBatch: %v", err)
	}
	if result.Applied || result.TerminalTransitioned {
		t.Fatalf("unexpected mutation flags: %+v", result)
	}
	if !strings.Contains(result.BatchJSON, `"status":"cancelled"`) {
		t.Fatalf("expected authoritative cancelled batch, got %s", result.BatchJSON)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("SQL expectations: %v", err)
	}
}

func TestCancelBatchReportsNoTransitionForTerminalBatch(t *testing.T) {
	db, mock, cleanup := newTaskRuntimeMockDB(t)
	defer cleanup()
	dao := NewTaskRuntimeDAO(db)
	payload := `{"batch_id":"batch-1","parent_conversation_id":1,"parent_turn_id":2,` +
		`"status":"completed","total_count":1,"created_at":10,"updated_at":20}`

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT .*t_task_runtime_batch.*FOR UPDATE").
		WithArgs("batch-1", 1).
		WillReturnRows(batchRows(statusCompleted, payload))
	mock.ExpectCommit()

	result, err := dao.CancelBatch(context.Background(), "batch-1", "duplicate cancellation")
	if err != nil {
		t.Fatalf("CancelBatch: %v", err)
	}
	if result.Transitioned {
		t.Fatalf("terminal batch should not transition again: %+v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("SQL expectations: %v", err)
	}
}

func newTaskRuntimeMockDB(t *testing.T) (*gorm.DB, sqlmock.Sqlmock, func()) {
	t.Helper()
	sqlDB, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create mock database: %v", err)
	}
	db, err := gorm.Open(
		mysql.New(mysql.Config{Conn: sqlDB, SkipInitializeWithVersion: true}),
		&gorm.Config{DisableAutomaticPing: true},
	)
	if err != nil {
		_ = sqlDB.Close()
		t.Fatalf("open GORM database: %v", err)
	}
	return db, mock, func() { _ = sqlDB.Close() }
}

func batchRows(status, payload string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id",
		columnBatchID,
		columnParentConversationID,
		columnParentTurnID,
		columnParentToolCallID,
		columnStatus,
		columnReason,
		columnJoinStrategy,
		columnTotalCount,
		columnCountsJSON,
		columnBatchJSON,
		columnCreatedAt,
		columnUpdatedAt,
		columnLivenessAt,
		columnEndedAt,
		columnCancellationReason,
	}).AddRow(1, "batch-1", 1, 2, nil, status, "", joinStrategyPartialOK, 1, `{}`, payload, 10, 20, 10, nil, "")
}

func TestBatchUpdateDecision(t *testing.T) {
	tests := []struct {
		name                       string
		existingStatus, nextStatus string
		applied, transitioned      bool
	}{
		{name: "active progress", existingStatus: statusRunning, nextStatus: statusRunning, applied: true},
		{
			name:           "terminal transition",
			existingStatus: statusRunning,
			nextStatus:     statusCompleted,
			applied:        true,
			transitioned:   true,
		},
		{name: "terminal idempotency", existingStatus: statusCompleted, nextStatus: statusCompleted},
		{name: "terminal conflict", existingStatus: statusCancelled, nextStatus: statusCompleted},
		{name: "terminal resurrection", existingStatus: statusCompleted, nextStatus: statusRunning},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			applied, transitioned := batchUpdateDecision(tt.existingStatus, tt.nextStatus)
			if applied != tt.applied || transitioned != tt.transitioned {
				t.Fatalf(
					"batchUpdateDecision(%q, %q) = (%v, %v), want (%v, %v)",
					tt.existingStatus,
					tt.nextStatus,
					applied,
					transitioned,
					tt.applied,
					tt.transitioned,
				)
			}
		})
	}
}

func TestRunStatusCounts(t *testing.T) {
	runs := []runRow{
		{Status: statusCompleted},
		{Status: statusCompleted},
		{Status: statusFailed},
		{Status: statusCancelled},
		{Status: statusTimedOut},
		{Status: statusBlocked},
		{Status: statusRunning},
	}
	want := map[string]int{
		statusCompleted: 2,
		statusFailed:    1,
		statusCancelled: 1,
		statusTimedOut:  1,
		statusBlocked:   1,
	}
	got := runStatusCounts(runs)
	for status, count := range want {
		if got[status] != count {
			t.Fatalf("count[%q] = %d, want %d", status, got[status], count)
		}
	}
}

func TestListBatchRunsOmitsResultJSON(t *testing.T) {
	sqlDB, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create mock database: %v", err)
	}
	defer func() { _ = sqlDB.Close() }()

	db, err := gorm.Open(
		mysql.New(mysql.Config{Conn: sqlDB, SkipInitializeWithVersion: true}),
		&gorm.Config{DisableAutomaticPing: true, DryRun: true},
	)
	if err != nil {
		t.Fatalf("open GORM database: %v", err)
	}

	var statement string
	if err := db.Callback().Query().After("gorm:query").Register("capture-list-batch-runs", func(tx *gorm.DB) {
		statement = tx.Statement.SQL.String()
	}); err != nil {
		t.Fatalf("register query capture callback: %v", err)
	}

	if _, err := NewTaskRuntimeDAO(db).ListBatchRuns(context.Background(), " batch-1 "); err != nil {
		t.Fatalf("list batch runs: %v", err)
	}

	query := strings.ToLower(statement)
	if strings.Contains(query, columnResultJSON) {
		t.Fatalf("ListBatchRuns query must omit %s: %s", columnResultJSON, statement)
	}
	if !strings.Contains(query, columnRunJSON) {
		t.Fatalf("ListBatchRuns query must retain %s: %s", columnRunJSON, statement)
	}
}
