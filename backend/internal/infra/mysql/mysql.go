package mysql

import (
	"fmt"

	gormMysql "gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

func New() (*gorm.DB, error) {
	dsn, err := DSNFromEnvironment(false)
	if err != nil {
		return nil, err
	}

	db, err := gorm.Open(gormMysql.Open(dsn), &gorm.Config{
		NamingStrategy: schema.NamingStrategy{
			SingularTable: true,
		},
		TranslateError: true,
	})
	if err != nil {
		return nil, fmt.Errorf("mysql open: %w", err)
	}

	return db, nil
}
