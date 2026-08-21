package mysql

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestDSNFromEnvironmentPrefersDSN(t *testing.T) {
	t.Setenv("MYSQL_DSN", "user:pass@tcp(db:3306)/sico?parseTime=true")
	t.Setenv("DB_HOST", "ignored")

	dsn, err := DSNFromEnvironment(false)

	require.NoError(t, err)
	require.Equal(t, "user:pass@tcp(db:3306)/sico?parseTime=true", dsn)
}

func TestDSNFromEnvironmentBuildsSplitConfiguration(t *testing.T) {
	t.Setenv("MYSQL_DSN", "")
	t.Setenv("DB_HOST", "mysql")
	t.Setenv("DB_PORT", "3306")
	t.Setenv("DB_NAME", "sico")
	t.Setenv("DB_USER", "user")
	t.Setenv("DB_PASSWORD", "pass")

	dsn, err := DSNFromEnvironment(false)

	require.NoError(t, err)
	require.Equal(t, "user:pass@tcp(mysql:3306)/sico?charset=utf8mb4&parseTime=True&loc=Local", dsn)
}

func TestDSNFromEnvironmentEnablesMultiStatements(t *testing.T) {
	t.Setenv("MYSQL_DSN", "user:pass@tcp(db:3306)/sico?parseTime=true")

	dsn, err := DSNFromEnvironment(true)

	require.NoError(t, err)
	require.Contains(t, dsn, "multiStatements=true")
}

func TestDSNFromEnvironmentEnablesVerifiedTLS(t *testing.T) {
	t.Setenv("MYSQL_DSN", "user:pass@tcp(db:3306)/sico?parseTime=true")
	t.Setenv("MYSQL_TLS", "true")

	dsn, err := DSNFromEnvironment(false)

	require.NoError(t, err)
	require.Contains(t, dsn, "tls=true")
}

func TestDSNFromEnvironmentPreservesExplicitTLSMode(t *testing.T) {
	t.Setenv("MYSQL_DSN", "user:pass@tcp(db:3306)/sico?tls=skip-verify")
	t.Setenv("MYSQL_TLS", "true")

	dsn, err := DSNFromEnvironment(false)

	require.NoError(t, err)
	require.Contains(t, dsn, "tls=skip-verify")
}
