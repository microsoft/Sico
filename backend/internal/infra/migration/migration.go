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

package migration

import (
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"

	"github.com/golang-migrate/migrate/v4"
	mysqlmigrate "github.com/golang-migrate/migrate/v4/database/mysql"
	_ "github.com/golang-migrate/migrate/v4/source/file"

	"sico-backend/internal/consts"
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

	dbHost := env.MustGet(consts.DatabaseHost)
	dbPort := env.MustGet(consts.DatabasePort)
	dbUser := env.MustGet(consts.DatabaseUser)
	dbPassword := env.MustGet(consts.DatabasePassword)
	dbName := env.MustGet(consts.DatabaseName)

	dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&parseTime=True&multiStatements=true",
		dbUser, dbPassword, dbHost, dbPort, dbName)

	sqlDB, err := sql.Open("mysql", dsn)
	if err != nil {
		return 0, fmt.Errorf("failed to open mysql for migrations: %w", err)
	}
	defer func() {
		_ = sqlDB.Close()
	}()

	driver, err := mysqlmigrate.WithInstance(sqlDB, &mysqlmigrate.Config{})
	if err != nil {
		return 0, fmt.Errorf("failed to init mysql migrate driver: %w", err)
	}

	migrationsPath := filepath.Join(rootPath, "configs", "migrations")
	sourceURL := fmt.Sprintf("file://%s", filepath.ToSlash(migrationsPath))

	mInstance, err := migrate.NewWithDatabaseInstance(sourceURL, "mysql", driver)
	if err != nil {
		return 0, fmt.Errorf("failed to create migrate instance: %w", err)
	}

	if err := mInstance.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return 0, fmt.Errorf("failed to apply migrations: %w", err)
	}

	if version, dirty, err := mInstance.Version(); err != nil {
		return 0, fmt.Errorf("failed to query migration version: %w", err)
	} else if dirty {
		return 0, fmt.Errorf(
			"database schema is dirty at version %d; fix with migrate force %d then rerun",
			version, version,
		)
	} else {
		return version, nil
	}
}
