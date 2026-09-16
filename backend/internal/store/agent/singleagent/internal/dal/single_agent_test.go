package dal

import (
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"

	entity "sico-backend/internal/entity/agent/singleagent"
	"sico-backend/internal/store/agent/singleagent/internal/dal/model"
)

func TestApplyOrganizationFilter(t *testing.T) {
	db := newSingleAgentDryRunDB(t)
	organizationID := int64(42)

	tests := []struct {
		name                        string
		includeOrgFreePublishedOnly bool
		wantSQL                     string
		wantVars                    []interface{}
	}{
		{
			name:                        "deploy includes selected and global organizations",
			includeOrgFreePublishedOnly: true,
			wantSQL:                     "organization_id IN (?,?)",
			wantVars:                    []interface{}{organizationID, int64(0)},
		},
		{
			name:     "manage narrows to selected organization",
			wantSQL:  "organization_id = ?",
			wantVars: []interface{}{organizationID},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			filter := &entity.ListSingleAgentFilter{
				OrganizationID:              &organizationID,
				IncludeOrgFreePublishedOnly: test.includeOrgFreePublishedOnly,
			}
			var agents []*model.TSingleAgent
			statement := applyOrganizationFilter(db.Model(&model.TSingleAgent{}), filter).Find(&agents).Statement

			require.Contains(t, statement.SQL.String(), test.wantSQL)
			require.Equal(t, test.wantVars, statement.Vars)
		})
	}
}

func newSingleAgentDryRunDB(t *testing.T) *gorm.DB {
	t.Helper()
	sqlDB, _, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })

	db, err := gorm.Open(
		mysql.New(mysql.Config{Conn: sqlDB, SkipInitializeWithVersion: true}),
		&gorm.Config{DisableAutomaticPing: true, DryRun: true},
	)
	require.NoError(t, err)
	return db
}
