package migration

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database"
	mysqlmigrate "github.com/golang-migrate/migrate/v4/database/mysql"
	_ "github.com/golang-migrate/migrate/v4/source/file"

	infraMysql "sico-backend/internal/infra/mysql"
	"sico-backend/pkg/env"
)

// Migrator applies database migrations.
type Migrator interface {
	Run() (uint, error)
}

const migrateTLSConfigName = "dbgen-custom"

// migrator implements database migration runner.
type migrator struct{}

// NewMigrator returns a migrator implementation.
func NewMigrator() Migrator {
	return &migrator{}
}

// Run applies all pending DB migrations.
func (m *migrator) Run() (uint, error) {
	rootPath := env.FindBackendRootPath()

	dsn, err := infraMysql.DSNFromEnvironment(true)
	if err != nil {
		return 0, err
	}

	sqlDB, err := sql.Open("mysql", dsn)
	if err != nil {
		return 0, fmt.Errorf("failed to open mysql for migrations: %w", err)
	}
	defer func() {
		_ = sqlDB.Close()
	}()

	return runPublicMigrations(sqlDB, rootPath)
}

func runPublicMigrations(sqlDB *sql.DB, rootPath string) (uint, error) {
	driver, err := newDatabaseDriver(sqlDB, &mysqlmigrate.Config{})
	if err != nil {
		return 0, fmt.Errorf("failed to init mysql migrate driver: %w", err)
	}
	migrationsPath := filepath.Join(rootPath, "configs", "migrations")
	sourceURL := fmt.Sprintf("file://%s", filepath.ToSlash(migrationsPath))
	mInstance, err := migrate.NewWithDatabaseInstance(sourceURL, "mysql", driver)
	if err != nil {
		_ = driver.Close()
		return 0, fmt.Errorf("failed to create migrate instance: %w", err)
	}
	return applyAndClose(mInstance, "database")
}

func newDatabaseDriver(sqlDB *sql.DB, config *mysqlmigrate.Config) (database.Driver, error) {
	ctx := context.Background()
	conn, err := sqlDB.Conn(ctx)
	if err != nil {
		return nil, err
	}
	driver, err := mysqlmigrate.WithConnection(ctx, conn, config)
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	return driver, nil
}

func applyAndClose(mInstance *migrate.Migrate, name string) (uint, error) {
	version, runErr := apply(mInstance, name)
	sourceErr, databaseErr := mInstance.Close()
	if runErr != nil {
		return 0, runErr
	}
	if sourceErr != nil || databaseErr != nil {
		return 0, fmt.Errorf("close %s migrator: source=%v database=%v", name, sourceErr, databaseErr)
	}
	return version, nil
}

func apply(mInstance *migrate.Migrate, name string) (uint, error) {
	if err := mInstance.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return 0, fmt.Errorf("apply %s migrations: %w", name, err)
	}
	version, dirty, err := mInstance.Version()
	if err != nil {
		return 0, fmt.Errorf("query %s migration version: %w", name, err)
	}
	if dirty {
		return 0, fmt.Errorf(
			"%s schema is dirty at version %d; fix with migrate force %d then rerun",
			name,
			version,
			version,
		)
	}
	return version, nil
}
