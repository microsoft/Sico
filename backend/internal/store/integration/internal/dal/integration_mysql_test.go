package dal

import (
	"context"
	"database/sql"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"

	drivermysql "github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/datatypes"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"sico-backend/internal/store/integration/internal/dal/model"
)

func TestMySQLIntegrationEntitlementOwnershipAndSnapshots(t *testing.T) {
	database := isolatedIntegrationMySQL(t)
	metadata := datatypes.JSON(`{"schemaVersion":1,"targetTenantId":"tenant",` +
		`"targetServicePrincipalObjectId":"principal","externalOrganizationId":"ado-org",` +
		`"externalOrganizationName":"office"}`)
	first := &model.TIntegrationConnection{
		ConnectionKey: "first", OrganizationID: 42, Provider: "azure_devops", Mode: 2, Status: 4, Metadata: metadata,
	}
	require.NoError(t, database.Create(first).Error)
	duplicate := &model.TIntegrationConnection{
		ConnectionKey: "duplicate", OrganizationID: 43, Provider: "azure_devops", Mode: 2, Status: 4, Metadata: metadata,
	}
	assert.ErrorIs(t, database.Create(duplicate).Error, gorm.ErrDuplicatedKey)
	personal := &model.TIntegrationConnection{
		ConnectionKey: "personal", OrganizationID: 42, ProjectID: 100,
		Provider: "azure_devops", Mode: 1, Status: 4, Metadata: metadata,
	}
	require.NoError(t, database.Create(personal).Error)
	require.NoError(t, database.Delete(first).Error)
	duplicate.ID = 0
	require.NoError(t, database.Create(duplicate).Error)
	assert.ErrorIs(t, database.Unscoped().Model(first).Update("deleted_at", nil).Error, gorm.ErrDuplicatedKey)

	dao := NewIntegrationDAO(database)
	snapshot, err := dao.GetConnectionByKey(context.Background(), "personal")
	require.NoError(t, err)
	require.NoError(t, dao.UpdateConnectionState(context.Background(), snapshot, map[string]any{
		"metadata": snapshot.Metadata, "updated_at": snapshot.UpdatedAt,
	}))
	snapshot.Metadata = metadata
	nextMetadata := datatypes.JSON(`{"schemaVersion":1,"operation":{"id":"new-operation"}}`)
	require.NoError(t, dao.UpdateConnectionState(context.Background(), snapshot, map[string]any{"metadata": nextMetadata}))
	assert.ErrorIs(t, dao.UpdateConnectionState(
		context.Background(), snapshot, map[string]any{"metadata": metadata},
	), ErrConnectionStateConflict)
	require.NoError(t, dao.SaveCredentialVersion(context.Background(), snapshot, credentialVersion(1), nil))
	updated, err := dao.GetConnectionByKey(context.Background(), "personal")
	require.NoError(t, err)
	assert.JSONEq(t, string(nextMetadata), string(updated.Metadata))
	assert.Equal(t, int64(1), updated.CredentialVersion)
	assert.ErrorIs(t, dao.DeleteConnection(context.Background(), snapshot, "admin"), ErrConnectionStateConflict)

	start := make(chan struct{})
	results := make(chan error, 2)
	for _, operationID := range []string{"first-operation", "second-operation"} {
		go func() {
			<-start
			results <- dao.UpdateConnectionState(context.Background(), updated, map[string]any{
				"metadata": datatypes.JSON(`{"schemaVersion":1,"operation":{"id":"` + operationID + `"}}`),
			})
		}()
	}
	close(start)
	succeeded := 0
	for range 2 {
		if result := <-results; result == nil {
			succeeded++
		} else {
			require.ErrorIs(t, result, ErrConnectionStateConflict)
		}
	}
	assert.Equal(t, 1, succeeded)

	beforeRevoke, err := dao.GetConnectionByKey(context.Background(), "personal")
	require.NoError(t, err)
	require.NoError(t, dao.UpdateConnectionState(context.Background(), beforeRevoke, map[string]any{
		"status": int32(9), "metadata": datatypes.JSON(`{"schemaVersion":1,"stage":"provider_revoked"}`),
	}))
	revoked, err := dao.GetConnectionByKey(context.Background(), "personal")
	require.NoError(t, err)
	require.NoError(t, database.Exec("CREATE TRIGGER fail_credential_cleanup BEFORE DELETE ON t_integration_credential "+
		"FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected cleanup failure'").Error)
	require.Error(t, dao.DeleteConnection(context.Background(), revoked, "admin"))
	afterFailure, err := dao.GetConnectionByKey(context.Background(), "personal")
	require.NoError(t, err)
	assert.Equal(t, int32(9), afterFailure.Status)
	assert.JSONEq(t, string(revoked.Metadata), string(afterFailure.Metadata))
	_, err = dao.GetCredentialVersion(context.Background(), personal.ID, 1)
	require.NoError(t, err)
	require.NoError(t, database.Exec("DROP TRIGGER fail_credential_cleanup").Error)
	require.NoError(t, dao.DeleteConnection(context.Background(), afterFailure, "admin"))

	down, err := os.ReadFile("../../../../../configs/migrations/000010_integration_connections.down.sql")
	require.NoError(t, err)
	require.NoError(t, database.Exec(string(down)).Error)
	assert.False(t, database.Migrator().HasTable(&model.TIntegrationConnection{}))
	up, err := os.ReadFile("../../../../../configs/migrations/000010_integration_connections.up.sql")
	require.NoError(t, err)
	require.NoError(t, database.Exec(string(up)).Error)
}

func TestMySQLPersonalConnectionsAreUniqueOnlyWithinProjectAndOwner(t *testing.T) {
	database := isolatedIntegrationMySQL(t)
	metadata := datatypes.JSON(`{"schemaVersion":1,"targetTenantId":"tenant","profileId":"account"}`)
	connection := func(key, owner string, projectID int64) *model.TIntegrationConnection {
		return &model.TIntegrationConnection{
			ConnectionKey: key, OrganizationID: 42, ProjectID: projectID, OwnerUsername: owner,
			Provider: "azure_devops", Mode: 1, Status: 4, Metadata: metadata,
		}
	}
	require.Error(t, database.Create(connection("unscoped", "alice", 0)).Error)
	first := connection("first", "alice", 100)
	require.NoError(t, database.Create(first).Error)
	duplicate := connection("duplicate", "alice", 100)
	assert.ErrorIs(t, database.Create(duplicate).Error, gorm.ErrDuplicatedKey)
	require.NoError(t, database.Create(connection("second-project", "alice", 200)).Error)
	require.NoError(t, database.Create(connection("another-owner", "bob", 100)).Error)
	draft := connection("draft", "alice", 100)
	draft.Metadata = nil
	draft.Status = 1
	require.NoError(t, database.Create(draft).Error)
	dao := NewIntegrationDAO(database)
	assert.ErrorIs(t, dao.SaveCredentialVersion(context.Background(), draft, credentialVersion(1), map[string]any{
		"metadata": metadata, "status": int32(4),
	}), gorm.ErrDuplicatedKey)
	_, err := dao.GetCredentialVersion(context.Background(), draft.ID, 1)
	assert.ErrorIs(t, err, gorm.ErrRecordNotFound)
	require.NoError(t, dao.UpdateConnectionState(context.Background(), first, map[string]any{
		"metadata": datatypes.JSONSet("metadata").Set("stage", "active"),
	}))
	binding := &model.TIntegrationBinding{
		ConnectionID: first.ID, SicoScopeType: 2, SicoScopeID: "100",
		ResourceType: "project", ResourceKey: "ado-org/old-project", Status: 1,
	}
	assert.ErrorIs(t, dao.CreateOrReactivateBinding(context.Background(), first, binding), ErrConnectionNotActive)
	assert.ErrorIs(t, dao.UpdateBindingStatus(context.Background(), first, 99, 1), ErrConnectionNotActive)
	current, err := dao.GetConnectionByKey(context.Background(), "first")
	require.NoError(t, err)
	require.NoError(t, dao.CreateOrReactivateBinding(context.Background(), current, binding))
	require.NoError(t, database.Delete(first).Error)
	duplicate.ID = 0
	require.NoError(t, database.Create(duplicate).Error)
}

func isolatedIntegrationMySQL(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("SICO_INTEGRATION_TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("set SICO_INTEGRATION_TEST_MYSQL_DSN to a local disposable MySQL server")
	}
	config, err := drivermysql.ParseDSN(dsn)
	require.NoError(t, err)
	host, _, err := net.SplitHostPort(config.Addr)
	require.NoError(t, err)
	require.Contains(t, []string{"127.0.0.1", "localhost", "::1"}, host)
	config.DBName = ""
	config.MultiStatements = true
	config.ParseTime = true
	server, err := sql.Open("mysql", config.FormatDSN())
	require.NoError(t, err)
	t.Cleanup(func() { _ = server.Close() })
	databaseName := "sico_integration_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	_, err = server.Exec("CREATE DATABASE `" + databaseName + "`")
	require.NoError(t, err)
	t.Cleanup(func() { _, _ = server.Exec("DROP DATABASE `" + databaseName + "`") })
	config.DBName = databaseName
	database, err := gorm.Open(mysql.Open(config.FormatDSN()), &gorm.Config{
		TranslateError: true, Logger: logger.Default.LogMode(logger.Silent),
	})
	require.NoError(t, err)
	sqlDatabase, err := database.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDatabase.Close() })
	migrations, err := filepath.Glob("../../../../../configs/migrations/*.up.sql")
	require.NoError(t, err)
	for _, path := range migrations {
		migration, err := os.ReadFile(path)
		require.NoError(t, err)
		require.NoError(t, database.Exec(string(migration)).Error, path)
	}
	return database
}
