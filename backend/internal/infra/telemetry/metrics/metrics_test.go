package metrics

import (
	"context"
	"errors"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

func TestQueryOrgProjectStats(t *testing.T) {
	db, mock, cleanup := newMetricsTestDB(t)
	defer cleanup()

	mock.ExpectQuery(regexp.QuoteMeta("SELECT COUNT(*) FROM t_organization WHERE deleted_at IS NULL")).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(3))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT COUNT(*) FROM t_project WHERE deleted_at IS NULL")).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(7))

	organizations, projects, err := queryOrgProjectStats(context.Background(), db)
	require.NoError(t, err)
	require.Equal(t, int64(3), organizations)
	require.Equal(t, int64(7), projects)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestQueryConversationStats(t *testing.T) {
	db, mock, cleanup := newMetricsTestDB(t)
	defer cleanup()

	mock.ExpectQuery(regexp.QuoteMeta("SELECT COUNT(*) FROM t_conversation WHERE deleted_at IS NULL")).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(5))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT role, COUNT(*) AS count FROM t_message GROUP BY role")).
		WillReturnRows(sqlmock.NewRows([]string{"role", "count"}).
			AddRow("", 1).
			AddRow("assistant", 4))

	conversationCount, err := queryConversationCount(context.Background(), db)
	require.NoError(t, err)
	require.Equal(t, int64(5), conversationCount)
	messages, err := queryMessageStats(context.Background(), db)
	require.NoError(t, err)
	require.Equal(t, []messageRoleRow{{Role: "unknown", Count: 1}, {Role: "assistant", Count: 4}}, messages)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestAgentStatsCallbackKeepsLastSuccessfulInstances(t *testing.T) {
	db, mock, cleanup := newMetricsTestDB(t)
	defer cleanup()
	reader := metric.NewManualReader()
	provider := metric.NewMeterProvider(metric.WithReader(reader))
	defer func() { require.NoError(t, provider.Shutdown(context.Background())) }()
	gauge, err := provider.Meter("test").Int64ObservableGauge("sico.agent.instance")
	require.NoError(t, err)
	_, err = provider.Meter("test").RegisterCallback(
		agentStatsCallback(&agentStatsState{}, db, 2, gauge),
		gauge,
	)
	require.NoError(t, err)

	query := "SELECT id, status, role FROM t_single_agent_instance WHERE deleted_at IS NULL ORDER BY id LIMIT 2"
	mock.ExpectQuery(regexp.QuoteMeta(query)).WillReturnRows(sqlmock.NewRows([]string{"id", "status", "role"}).
		AddRow(11, 3, "").
		AddRow(12, 4, "planner"))
	require.Equal(t, map[string]map[string]string{
		"11": {"role": "Unknown", "status": "INSTANCE_ACTIVE"},
		"12": {"role": "planner", "status": "INSTANCE_INACTIVE"},
	}, collectAgentInstances(t, reader))

	mock.ExpectQuery(regexp.QuoteMeta(query)).WillReturnError(errors.New("database unavailable"))
	require.Len(t, collectAgentInstances(t, reader), 2)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestAgentInstanceLimit(t *testing.T) {
	t.Setenv("SICO_METRICS_AGENT_INSTANCE_LIMIT", "25")
	require.Equal(t, 25, agentInstanceLimit())

	t.Setenv("SICO_METRICS_AGENT_INSTANCE_LIMIT", "0")
	require.Equal(t, defaultAgentInstanceLimit, agentInstanceLimit())

	t.Setenv("SICO_METRICS_AGENT_INSTANCE_LIMIT", "invalid")
	require.Equal(t, defaultAgentInstanceLimit, agentInstanceLimit())
}

func TestAgentStatsCollectsDefaultLimit(t *testing.T) {
	db, mock, cleanup := newMetricsTestDB(t)
	defer cleanup()
	reader := metric.NewManualReader()
	provider := metric.NewMeterProvider(metric.WithReader(reader))
	defer func() { require.NoError(t, provider.Shutdown(context.Background())) }()
	meter := provider.Meter("test")
	gauge, err := meter.Int64ObservableGauge("sico.agent.instance")
	require.NoError(t, err)
	_, err = meter.RegisterCallback(
		agentStatsCallback(&agentStatsState{}, db, defaultAgentInstanceLimit, gauge),
		gauge,
	)
	require.NoError(t, err)

	rows := sqlmock.NewRows([]string{"id", "status", "role"})
	for id := 1; id <= defaultAgentInstanceLimit; id++ {
		rows.AddRow(id, 3, "assistant")
	}
	query := "SELECT id, status, role FROM t_single_agent_instance WHERE deleted_at IS NULL ORDER BY id LIMIT 1000"
	mock.ExpectQuery(regexp.QuoteMeta(query)).WillReturnRows(rows)

	require.Len(t, collectAgentInstances(t, reader), defaultAgentInstanceLimit)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestQueryRBACStats(t *testing.T) {
	db, mock, cleanup := newMetricsTestDB(t)
	defer cleanup()

	usersQuery := "SELECT status, tenant, COUNT(*) AS count FROM t_user WHERE deleted_at IS NULL GROUP BY status, tenant"
	mock.ExpectQuery(regexp.QuoteMeta(usersQuery)).WillReturnRows(sqlmock.NewRows([]string{"status", "tenant", "count"}).
		AddRow(1, "", 3).
		AddRow(9, "PUBLIC", 1))
	bindingsQuery := "SELECT role_code, scope_type, COUNT(*) AS count FROM t_user_role WHERE deleted_at IS NULL" +
		" GROUP BY role_code, scope_type"
	bindingRows := sqlmock.NewRows([]string{"role_code", "scope_type", "count"}).
		AddRow("org_admin", "org", 2).
		AddRow("agent_admin", "agent", 1)
	mock.ExpectQuery(regexp.QuoteMeta(bindingsQuery)).WillReturnRows(bindingRows)

	users, bindings, err := queryRBACStats(context.Background(), db)
	require.NoError(t, err)
	require.Equal(t, []userStatusCount{
		{Status: "active", Tenant: "default", Count: 3},
		{Status: "unknown", Tenant: "PUBLIC", Count: 1},
	}, users)
	require.Equal(t, []roleBindingCount{
		{RoleCode: "org_admin", ScopeType: "org", Count: 2},
		{RoleCode: "agent_admin", ScopeType: "agent", Count: 1},
	}, bindings)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestRBACStatsCallbackKeepsLastSuccessfulValues(t *testing.T) {
	db, mock, cleanup := newMetricsTestDB(t)
	defer cleanup()
	reader := metric.NewManualReader()
	provider := metric.NewMeterProvider(metric.WithReader(reader))
	defer func() { require.NoError(t, provider.Shutdown(context.Background())) }()
	meter := provider.Meter("test")
	usersGauge, err := meter.Int64ObservableGauge("sico.rbac.users_total")
	require.NoError(t, err)
	bindingsGauge, err := meter.Int64ObservableGauge("sico.rbac.role_bindings_total")
	require.NoError(t, err)
	_, err = meter.RegisterCallback(
		rbacStatsCallback(&rbacStatsState{}, db, usersGauge, bindingsGauge),
		usersGauge,
		bindingsGauge,
	)
	require.NoError(t, err)

	usersQuery := "SELECT status, tenant, COUNT(*) AS count FROM t_user WHERE deleted_at IS NULL GROUP BY status, tenant"
	bindingsQuery := "SELECT role_code, scope_type, COUNT(*) AS count FROM t_user_role WHERE deleted_at IS NULL" +
		" GROUP BY role_code, scope_type"
	mock.ExpectQuery(regexp.QuoteMeta(usersQuery)).WillReturnRows(
		sqlmock.NewRows([]string{"status", "tenant", "count"}).AddRow(1, "PUBLIC", 4),
	)
	mock.ExpectQuery(regexp.QuoteMeta(bindingsQuery)).WillReturnRows(
		sqlmock.NewRows([]string{"role_code", "scope_type", "count"}).AddRow("org_admin", "org", 2),
	)
	require.Equal(t, int64(4), collectGaugeValue(t, reader, "sico.rbac.users_total"))

	mock.ExpectQuery(regexp.QuoteMeta(usersQuery)).WillReturnError(errors.New("database unavailable"))
	require.Equal(t, int64(4), collectGaugeValue(t, reader, "sico.rbac.users_total"))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSandboxStatsCallbackKeepsLastSuccessfulSnapshot(t *testing.T) {
	reader := metric.NewManualReader()
	provider := metric.NewMeterProvider(metric.WithReader(reader))
	defer func() { require.NoError(t, provider.Shutdown(context.Background())) }()
	meter := provider.Meter("test")
	resourcesGauge, err := meter.Int64ObservableGauge("sico.sandbox.resources_total")
	require.NoError(t, err)
	healthGauge, err := meter.Int64ObservableGauge("sico.sandbox.provider_healthy")
	require.NoError(t, err)
	snapshotProvider := &testSandboxMetricsProvider{snapshot: &SandboxSnapshot{
		ResourcesByTypeStatus: map[string]map[string]int64{"emulator": {"available": 2}},
		ProviderHealthy:       map[string]int64{"emulator": 1},
	}}
	_, err = meter.RegisterCallback(
		sandboxStatsCallback(&sandboxStatsState{}, snapshotProvider, resourcesGauge, healthGauge),
		resourcesGauge,
		healthGauge,
	)
	require.NoError(t, err)

	require.Equal(t, int64(2), collectGaugeValue(t, reader, "sico.sandbox.resources_total"))
	snapshotProvider.err = errors.New("snapshot unavailable")
	require.Equal(t, int64(2), collectGaugeValue(t, reader, "sico.sandbox.resources_total"))
}

type testSandboxMetricsProvider struct {
	snapshot *SandboxSnapshot
	err      error
}

func (provider *testSandboxMetricsProvider) MetricsSnapshot(context.Context) (*SandboxSnapshot, error) {
	return provider.snapshot, provider.err
}

func TestOrgProjectCallbackKeepsLastSuccessfulValues(t *testing.T) {
	db, mock, cleanup := newMetricsTestDB(t)
	defer cleanup()
	reader := metric.NewManualReader()
	provider := metric.NewMeterProvider(metric.WithReader(reader))
	defer func() { require.NoError(t, provider.Shutdown(context.Background())) }()
	meter := provider.Meter("test")
	orgGauge, err := meter.Int64ObservableGauge("sico.organization.total")
	require.NoError(t, err)
	projectGauge, err := meter.Int64ObservableGauge("sico.project.total")
	require.NoError(t, err)
	_, err = meter.RegisterCallback(
		orgProjectStatsCallback(&orgProjectStatsState{}, db, orgGauge, projectGauge),
		orgGauge,
		projectGauge,
	)
	require.NoError(t, err)

	mock.ExpectQuery(regexp.QuoteMeta("SELECT COUNT(*) FROM t_organization WHERE deleted_at IS NULL")).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(2))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT COUNT(*) FROM t_project WHERE deleted_at IS NULL")).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(4))
	require.Equal(t, int64(2), collectGaugeValue(t, reader, "sico.organization.total"))

	mock.ExpectQuery(regexp.QuoteMeta("SELECT COUNT(*) FROM t_organization WHERE deleted_at IS NULL")).
		WillReturnError(errors.New("database unavailable"))
	require.Equal(t, int64(2), collectGaugeValue(t, reader, "sico.organization.total"))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestRecordMessageCreated(t *testing.T) {
	reader := metric.NewManualReader()
	provider := metric.NewMeterProvider(metric.WithReader(reader))
	defer func() { require.NoError(t, provider.Shutdown(context.Background())) }()
	counter, err := provider.Meter("test").Int64Counter("sico.conversation.messages_created")
	require.NoError(t, err)

	previous := messagesCreatedCounter
	messagesCreatedCounter = counter
	defer func() { messagesCreatedCounter = previous }()
	RecordMessageCreated(context.Background(), "assistant")
	RecordMessageCreated(context.Background(), "")

	values := collectCounterValues(t, reader, "sico.conversation.messages_created")
	require.Equal(t, map[string]int64{"assistant": 1, "unknown": 1}, values)
}

func TestQueryTaskRuntimeStatsAndSuccessRate(t *testing.T) {
	db, mock, cleanup := newMetricsTestDB(t)
	defer cleanup()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT status, COUNT(*) AS count FROM t_task_runtime_run GROUP BY status")).
		WillReturnRows(sqlmock.NewRows([]string{"status", "count"}).
			AddRow("completed", 3).
			AddRow("failed", 1).
			AddRow("running", 2))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT status, COUNT(*) AS count FROM t_task_runtime_batch GROUP BY status")).
		WillReturnRows(sqlmock.NewRows([]string{"status", "count"}).AddRow("partial", 1))

	runs, batches, err := queryTaskRuntimeStats(context.Background(), db)
	require.NoError(t, err)
	require.Equal(t, 0.75, computeTaskSuccessRate(runs))
	require.Equal(t, []statusCount{{Status: "partial", Count: 1}}, batches)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestTaskRuntimeEventMetrics(t *testing.T) {
	reader := metric.NewManualReader()
	provider := metric.NewMeterProvider(metric.WithReader(reader))
	defer func() { require.NoError(t, provider.Shutdown(context.Background())) }()
	meter := provider.Meter("test")

	runsCreated, err := meter.Int64Counter("sico.task_runtime.runs_created")
	require.NoError(t, err)
	runsTerminal, err := meter.Int64Counter("sico.task_runtime.runs_terminal")
	require.NoError(t, err)
	batchesCreated, err := meter.Int64Counter("sico.task_runtime.batches_created")
	require.NoError(t, err)
	batchesTerminal, err := meter.Int64Counter("sico.task_runtime.batches_terminal")
	require.NoError(t, err)
	runDuration, err := meter.Int64Histogram("sico.task_runtime.run_duration_ms")
	require.NoError(t, err)
	batchDuration, err := meter.Int64Histogram("sico.task_runtime.batch_duration_ms")
	require.NoError(t, err)

	previousRunsCreated := taskRunsCreatedCounter
	previousRunsTerminal := taskRunsTerminalCounter
	previousBatchesCreated := taskBatchesCreatedCounter
	previousBatchesTerminal := taskBatchesTerminalCounter
	previousRunDuration := taskRunDurationHistogram
	previousBatchDuration := taskBatchDurationHistogram
	taskRunsCreatedCounter = runsCreated
	taskRunsTerminalCounter = runsTerminal
	taskBatchesCreatedCounter = batchesCreated
	taskBatchesTerminalCounter = batchesTerminal
	taskRunDurationHistogram = runDuration
	taskBatchDurationHistogram = batchDuration
	defer func() {
		taskRunsCreatedCounter = previousRunsCreated
		taskRunsTerminalCounter = previousRunsTerminal
		taskBatchesCreatedCounter = previousBatchesCreated
		taskBatchesTerminalCounter = previousBatchesTerminal
		taskRunDurationHistogram = previousRunDuration
		taskBatchDurationHistogram = previousBatchDuration
	}()

	RecordRunCreated(context.Background(), "python")
	RecordRunTerminal(context.Background(), "completed", "python", 125, true)
	RecordBatchCreated(context.Background())
	RecordBatchTerminal(context.Background(), "partial", 250, true)

	var resourceMetrics metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(context.Background(), &resourceMetrics))
	names := make(map[string]bool)
	for _, scopeMetrics := range resourceMetrics.ScopeMetrics {
		for _, measured := range scopeMetrics.Metrics {
			names[measured.Name] = true
		}
	}
	for _, name := range []string{
		"sico.task_runtime.runs_created",
		"sico.task_runtime.runs_terminal",
		"sico.task_runtime.batches_created",
		"sico.task_runtime.batches_terminal",
		"sico.task_runtime.run_duration_ms",
		"sico.task_runtime.batch_duration_ms",
	} {
		require.True(t, names[name], "metric %s was not collected", name)
	}
}

func newMetricsTestDB(t *testing.T) (*gorm.DB, sqlmock.Sqlmock, func()) {
	t.Helper()
	sqlDB, mock, err := sqlmock.New()
	require.NoError(t, err)
	db, err := gorm.Open(mysql.New(mysql.Config{
		Conn:                      sqlDB,
		SkipInitializeWithVersion: true,
	}), &gorm.Config{})
	require.NoError(t, err)
	return db, mock, func() { _ = sqlDB.Close() }
}

func collectGaugeValue(t *testing.T, reader *metric.ManualReader, name string) int64 {
	t.Helper()
	var resourceMetrics metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(context.Background(), &resourceMetrics))
	for _, scopeMetrics := range resourceMetrics.ScopeMetrics {
		for _, measured := range scopeMetrics.Metrics {
			if measured.Name == name {
				gauge, ok := measured.Data.(metricdata.Gauge[int64])
				require.True(t, ok)
				require.Len(t, gauge.DataPoints, 1)
				return gauge.DataPoints[0].Value
			}
		}
	}
	t.Fatalf("metric %q not collected", name)
	return 0
}

func collectCounterValues(t *testing.T, reader *metric.ManualReader, name string) map[string]int64 {
	t.Helper()
	var resourceMetrics metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(context.Background(), &resourceMetrics))
	values := make(map[string]int64)
	for _, scopeMetrics := range resourceMetrics.ScopeMetrics {
		for _, measured := range scopeMetrics.Metrics {
			if measured.Name != name {
				continue
			}
			sum, ok := measured.Data.(metricdata.Sum[int64])
			require.True(t, ok)
			for _, point := range sum.DataPoints {
				role, ok := point.Attributes.Value(attribute.Key("role"))
				require.True(t, ok)
				values[role.AsString()] = point.Value
			}
		}
	}
	return values
}

func collectAgentInstances(t *testing.T, reader *metric.ManualReader) map[string]map[string]string {
	t.Helper()
	var resourceMetrics metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(context.Background(), &resourceMetrics))
	instances := make(map[string]map[string]string)
	for _, scopeMetrics := range resourceMetrics.ScopeMetrics {
		for _, measured := range scopeMetrics.Metrics {
			if measured.Name != "sico.agent.instance" {
				continue
			}
			gauge, ok := measured.Data.(metricdata.Gauge[int64])
			require.True(t, ok)
			for _, point := range gauge.DataPoints {
				require.Equal(t, int64(1), point.Value)
				instanceID, ok := point.Attributes.Value(attribute.Key("instance_id"))
				require.True(t, ok)
				role, ok := point.Attributes.Value(attribute.Key("role"))
				require.True(t, ok)
				status, ok := point.Attributes.Value(attribute.Key("status"))
				require.True(t, ok)
				instances[instanceID.AsString()] = map[string]string{
					"role": role.AsString(), "status": status.AsString(),
				}
			}
		}
	}
	return instances
}
