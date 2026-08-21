package mysql

import (
	"os"
	"testing"
)

func TestNew(t *testing.T) {
	// Skip test if MYSQL_DSN is not set
	if os.Getenv("MYSQL_DSN") == "" {
		t.Skip("MYSQL_DSN environment variable not set")
	}

	db, err := New()
	if err != nil {
		t.Fatalf("Failed to create MySQL connection: %v", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("Failed to get underlying SQL DB: %v", err)
	}

	err = sqlDB.Ping()
	if err != nil {
		t.Fatalf("Failed to ping database: %v", err)
	}

	// Close connection
	err = sqlDB.Close()
	if err != nil {
		t.Errorf("Failed to close database connection: %v", err)
	}

	t.Log("MySQL connection test passed")
}
