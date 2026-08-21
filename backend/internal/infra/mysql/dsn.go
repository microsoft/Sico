package mysql

import (
	"fmt"
	"os"
	"strings"

	mysqldriver "github.com/go-sql-driver/mysql"

	"sico-backend/internal/consts"
	"sico-backend/pkg/env"
)

func DSNFromEnvironment(multiStatements bool) (string, error) {
	dsn := os.Getenv(consts.DatabaseDSN)
	if dsn == "" {
		dsn = fmt.Sprintf(
			"%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&parseTime=True&loc=Local",
			env.MustGet(consts.DatabaseUser),
			env.MustGet(consts.DatabasePassword),
			env.MustGet(consts.DatabaseHost),
			env.MustGet(consts.DatabasePort),
			env.MustGet(consts.DatabaseName),
		)
	}
	config, err := mysqldriver.ParseDSN(dsn)
	if err != nil {
		return "", fmt.Errorf("parse mysql configuration: %w", err)
	}
	if strings.EqualFold(strings.TrimSpace(os.Getenv("MYSQL_TLS")), "true") &&
		(config.TLSConfig == "" || config.TLSConfig == "false") {
		config.TLSConfig = "true"
	}
	if !multiStatements && config.TLSConfig == "" {
		return dsn, nil
	}
	config.MultiStatements = true
	if !multiStatements {
		config.MultiStatements = false
	}
	return config.FormatDSN(), nil
}
