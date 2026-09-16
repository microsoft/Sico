package dal

import (
	"context"
	"errors"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/datatypes"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"

	"sico-backend/internal/store/integration/internal/dal/model"
)

func TestCreateOrReactivateBindingReusesSoftDeletedRecord(t *testing.T) {
	database, mock, closeDatabase := newIntegrationTestDatabase(t)
	defer closeDatabase()
	dao := NewIntegrationDAO(database)
	deletedAt := time.Now()
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT `id` FROM `t_integration_connection`.*FOR UPDATE").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(1)))
	mock.ExpectQuery("SELECT .*`t_integration_binding`.*FOR UPDATE").
		WillReturnRows(bindingRows().AddRow(
			int64(9), int64(1), int32(1), "42", "repository", "repo-id", "old-repo",
			int32(2), []byte(`{"schemaVersion":1}`),
			"alice", int64(1000), int64(2000), deletedAt,
		))
	mock.ExpectExec("UPDATE `t_integration_binding` SET .*").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	binding := &model.TIntegrationBinding{
		ConnectionID:    1,
		SicoScopeType:   1,
		SicoScopeID:     "42",
		ResourceType:    "repository",
		ResourceKey:     "repo-id",
		ResourceName:    "new-repo",
		Status:          1,
		Metadata:        datatypes.JSON(`{"schemaVersion":1,"installationId":"123"}`),
		CreatorUsername: "bob",
	}

	err := dao.CreateOrReactivateBinding(context.Background(), &model.TIntegrationConnection{ID: 1, Status: 4}, binding)

	require.NoError(t, err)
	assert.Equal(t, int64(9), binding.ID)
	assert.Equal(t, "alice", binding.CreatorUsername)
	assert.False(t, binding.DeletedAt.Valid)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestListConnectionsUsesOwningProject(t *testing.T) {
	database, mock, closeDatabase := newIntegrationTestDatabase(t)
	defer closeDatabase()

	dao := NewIntegrationDAO(database)
	provider := "azure_devops"
	mode := int32(1)

	mock.ExpectQuery("SELECT count\\(\\*\\).*organization_id = \\?.*project_id = \\?").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery("SELECT .* FROM `t_integration_connection`.*project_id = \\?.*" +
		"ORDER BY t_integration_connection.id DESC").
		WillReturnRows(connectionRows().AddRow(
			int64(1), "connection", int64(42), "alice", provider, mode, int32(4),
			"Alice ADO", "profile", int64(1), []byte(`{"schemaVersion":1}`),
			"alice", "alice", int64(1000), int64(2000), nil,
		))

	connections, total, err := dao.ListConnections(
		context.Background(),
		&ConnectionFilter{
			OrganizationID: 42,
			ProjectID:      100,
			Provider:       &provider,
			Mode:           &mode,
		},
		0,
		100,
	)

	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	require.Len(t, connections, 1)
	assert.Equal(t, "alice", connections[0].OwnerUsername)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestProjectConnectionFilterDoesNotJoinResourceBindings(test *testing.T) {
	database, _, closeDatabase := newIntegrationTestDatabase(test)
	defer closeDatabase()

	query := database.Session(&gorm.Session{DryRun: true}).Model(&model.TIntegrationConnection{})
	query = applyConnectionFilter(query, &ConnectionFilter{
		OrganizationID: 42,
		ProjectID:      100,
	})

	result := query.Find(&[]model.TIntegrationConnection{})
	require.NoError(test, result.Error)

	assert.NotContains(test, result.Statement.SQL.String(), "t_integration_binding")
	assert.NotContains(test, result.Statement.SQL.String(), "JSON_EXTRACT")
	assert.Equal(test, []any{int64(42), int64(100)}, result.Statement.Vars)
}

func TestCreateOrReactivateBindingRejectsActiveDuplicate(t *testing.T) {
	database, mock, closeDatabase := newIntegrationTestDatabase(t)
	defer closeDatabase()
	dao := NewIntegrationDAO(database)
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT `id` FROM `t_integration_connection`.*FOR UPDATE").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(1)))
	mock.ExpectQuery("SELECT .*`t_integration_binding`.*FOR UPDATE").
		WillReturnRows(bindingRows().AddRow(
			int64(9), int64(1), int32(1), "42", "repository", "repo-id", "repo",
			int32(1), nil, "alice", int64(1000), int64(2000), nil,
		))
	mock.ExpectRollback()

	binding := &model.TIntegrationBinding{
		ConnectionID:  1,
		SicoScopeType: 1,
		SicoScopeID:   "42",
		ResourceType:  "repository",
		ResourceKey:   "repo-id",
	}
	err := dao.CreateOrReactivateBinding(context.Background(), &model.TIntegrationConnection{ID: 1, Status: 4}, binding)

	assert.ErrorIs(t, err, gorm.ErrDuplicatedKey)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCreateOrReactivateBindingRejectsInactiveConnection(t *testing.T) {
	database, mock, closeDatabase := newIntegrationTestDatabase(t)
	defer closeDatabase()
	dao := NewIntegrationDAO(database)
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT `id` FROM `t_integration_connection`.*FOR UPDATE").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectRollback()

	binding := &model.TIntegrationBinding{
		ConnectionID:  1,
		SicoScopeType: 1,
		SicoScopeID:   "42",
		ResourceType:  "repository",
		ResourceKey:   "repo-id",
	}
	err := dao.CreateOrReactivateBinding(context.Background(), &model.TIntegrationConnection{ID: 1, Status: 4}, binding)

	assert.ErrorIs(t, err, ErrConnectionNotActive)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestUpdateBindingStatusLocksActiveConnectionBeforeBinding(t *testing.T) {
	database, mock, closeDatabase := newIntegrationTestDatabase(t)
	defer closeDatabase()
	dao := NewIntegrationDAO(database)
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT `id` FROM `t_integration_connection`.*FOR UPDATE").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(1)))
	mock.ExpectQuery("SELECT .*`t_integration_binding`.*FOR UPDATE").
		WillReturnRows(bindingRows().AddRow(
			int64(9), int64(1), int32(1), "42", "repository", "repo-id", "repo",
			int32(2), nil, "alice", int64(1000), int64(2000), nil,
		))
	mock.ExpectExec("UPDATE `t_integration_binding` SET .*").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	err := dao.UpdateBindingStatus(context.Background(), &model.TIntegrationConnection{ID: 1, Status: 4}, 9, 1)

	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestDeleteConnectionRejectsStaleSnapshot(t *testing.T) {
	database, mock, closeDatabase := newIntegrationTestDatabase(t)
	defer closeDatabase()
	dao := NewIntegrationDAO(database)
	metadata := datatypes.JSON(`{"schemaVersion":1,"operation":{"id":"old"}}`)
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE `t_integration_connection` SET .*WHERE .*metadata <=> CAST\\(\\? AS JSON\\)").
		WithArgs(7, "admin", sqlmock.AnyArg(), int64(1), int32(9), string(metadata)).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectRollback()

	err := dao.DeleteConnection(
		context.Background(), &model.TIntegrationConnection{ID: 1, Status: 9, Metadata: metadata}, "admin",
	)

	assert.ErrorIs(t, err, ErrConnectionStateConflict)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestUpdateConnectionStateRejectsLostTransition(t *testing.T) {
	database, mock, closeDatabase := newIntegrationTestDatabase(t)
	defer closeDatabase()
	dao := NewIntegrationDAO(database)
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE `t_integration_connection` SET .*").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()
	mock.ExpectQuery("SELECT count\\(\\*\\) FROM `t_integration_connection`.*metadata <=>").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(0)))

	err := dao.UpdateConnectionState(
		context.Background(), &model.TIntegrationConnection{ID: 1, Status: 2},
		map[string]any{"metadata": datatypes.JSON(`{}`)},
	)

	assert.ErrorIs(t, err, ErrConnectionStateConflict)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestMarkConnectionReauthorizationRequiredRejectsStaleCredential(t *testing.T) {
	database, mock, closeDatabase := newIntegrationTestDatabase(t)
	defer closeDatabase()
	dao := NewIntegrationDAO(database)
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE `t_integration_connection` SET .*").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()

	err := dao.MarkConnectionReauthorizationRequired(context.Background(), 1, 4, 2, "alice")

	assert.ErrorIs(t, err, ErrConnectionStateConflict)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSaveCredentialVersionCommitsSuccessfulCAS(t *testing.T) {
	database, mock, closeDatabase := newIntegrationTestDatabase(t)
	defer closeDatabase()
	dao := NewIntegrationDAO(database)
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO `t_integration_credential`") + ".*").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE `t_integration_connection` SET .*").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	err := dao.SaveCredentialVersion(
		context.Background(),
		&model.TIntegrationConnection{ID: 10, CredentialVersion: 1, Status: 4},
		credentialVersion(2),
		map[string]any{"status": 4},
	)

	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSaveCredentialVersionRejectsStaleMetadata(t *testing.T) {
	database, mock, closeDatabase := newIntegrationTestDatabase(t)
	defer closeDatabase()
	dao := NewIntegrationDAO(database)
	previousMetadata := datatypes.JSON(`{"schemaVersion":1,"operationId":"old"}`)
	nextMetadata := datatypes.JSON(`{"schemaVersion":1,"operationId":"next"}`)
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO `t_integration_credential`") + ".*").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE `t_integration_connection` SET .*WHERE .*metadata <=> CAST\\(\\? AS JSON\\)").
		WithArgs(
			int64(2), string(nextMetadata), sqlmock.AnyArg(), int64(10), int64(1), int32(4), string(previousMetadata),
		).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectRollback()

	err := dao.SaveCredentialVersion(
		context.Background(),
		&model.TIntegrationConnection{ID: 10, CredentialVersion: 1, Status: 4, Metadata: previousMetadata},
		credentialVersion(2),
		map[string]any{"metadata": nextMetadata},
	)

	assert.ErrorIs(t, err, ErrCredentialVersionConflict)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSaveCredentialVersionPrunesOldCredentialHistory(t *testing.T) {
	database, mock, closeDatabase := newIntegrationTestDatabase(t)
	defer closeDatabase()
	dao := NewIntegrationDAO(database)
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO `t_integration_credential`") + ".*").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE `t_integration_connection` SET .*").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("DELETE FROM `t_integration_credential` WHERE connection_id = \\? AND version <= \\?").
		WithArgs(int64(10), int64(1)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	err := dao.SaveCredentialVersion(
		context.Background(),
		&model.TIntegrationConnection{ID: 10, CredentialVersion: 3, Status: 4},
		credentialVersion(4),
		nil,
	)

	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSaveCredentialVersionRollsBackLostCAS(t *testing.T) {
	database, mock, closeDatabase := newIntegrationTestDatabase(t)
	defer closeDatabase()
	dao := NewIntegrationDAO(database)
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO `t_integration_credential`") + ".*").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE `t_integration_connection` SET .*").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectRollback()
	err := dao.SaveCredentialVersion(
		context.Background(),
		&model.TIntegrationConnection{ID: 10, CredentialVersion: 1, Status: 4},
		credentialVersion(2),
		nil,
	)

	assert.True(t, errors.Is(err, ErrCredentialVersionConflict))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSaveCredentialVersionMapsDuplicateVersionToConflict(t *testing.T) {
	database, mock, closeDatabase := newIntegrationTestDatabase(t)
	defer closeDatabase()
	dao := NewIntegrationDAO(database)
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO `t_integration_credential`") + ".*").
		WillReturnError(gorm.ErrDuplicatedKey)
	mock.ExpectRollback()

	err := dao.SaveCredentialVersion(
		context.Background(),
		&model.TIntegrationConnection{ID: 10, CredentialVersion: 1, Status: 4},
		credentialVersion(2),
		nil,
	)

	assert.ErrorIs(t, err, ErrCredentialVersionConflict)
	require.NoError(t, mock.ExpectationsWereMet())
}

func newIntegrationTestDatabase(t *testing.T) (*gorm.DB, sqlmock.Sqlmock, func()) {
	t.Helper()
	sqlDatabase, mock, err := sqlmock.New()
	require.NoError(t, err)
	database, err := gorm.Open(mysql.New(mysql.Config{
		Conn:                      sqlDatabase,
		SkipInitializeWithVersion: true,
	}), &gorm.Config{})
	require.NoError(t, err)
	return database, mock, func() { _ = sqlDatabase.Close() }
}

func bindingRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id",
		"connection_id",
		"sico_scope_type",
		"sico_scope_id",
		"resource_type",
		"resource_key",
		"resource_name",
		"status",
		"metadata",
		"creator_username",
		"created_at",
		"updated_at",
		"deleted_at",
	})
}

func connectionRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id",
		"connection_key",
		"organization_id",
		"owner_username",
		"provider",
		"mode",
		"status",
		"display_name",
		"external_id",
		"credential_version",
		"metadata",
		"creator_username",
		"updater_username",
		"created_at",
		"updated_at",
		"deleted_at",
	})
}

func credentialVersion(version int64) *model.TIntegrationCredential {
	return &model.TIntegrationCredential{
		Version:       version,
		Scheme:        "envelope-aes-256-gcm-v1",
		KeyID:         "root-key-v1",
		EncryptedData: []byte("ciphertext"),
	}
}
