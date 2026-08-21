package dal

import (
	"context"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"sico-backend/internal/store/authstate/internal/dal/model"
	"sico-backend/internal/store/authstate/internal/dal/query"
)

type AuthStateDAO struct {
	query *query.Query
	db    *gorm.DB
}

func NewAuthStateDAO(db *gorm.DB) *AuthStateDAO {
	return &AuthStateDAO{query: query.Use(db), db: db}
}

func (d *AuthStateDAO) GetByAccountSite(
	ctx context.Context,
	accountKey, siteHost string,
) (*model.TAuthState, error) {
	q := d.query.TAuthState
	return q.WithContext(ctx).
		Where(q.AccountKey.Eq(accountKey), q.SiteHost.Eq(siteHost)).
		First()
}

func (d *AuthStateDAO) Upsert(ctx context.Context, model *model.TAuthState) (int64, error) {
	now := time.Now().UnixMilli()
	model.CreatedAt = now
	model.UpdatedAt = now
	assignments := map[string]any{
		"state_blob_path":   model.StateBlobPath,
		"status":            model.Status,
		"expires_at":        model.ExpiresAt,
		"last_validated_at": model.LastValidatedAt,
		"updated_at":        now,
		"deleted_at":        gorm.Expr("NULL"),
	}
	if model.Metadata != nil {
		assignments["metadata"] = model.Metadata
	}
	if err := d.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "account_key"}, {Name: "site_host"}},
		DoUpdates: clause.Assignments(assignments),
	}).Create(model).Error; err != nil {
		return 0, err
	}

	row, err := d.GetByAccountSite(ctx, model.AccountKey, model.SiteHost)
	if err != nil {
		return 0, err
	}

	return row.ID, nil
}

func (d *AuthStateDAO) UpdateStatus(
	ctx context.Context,
	accountKey, siteHost string,
	status int32,
) error {
	q := d.query.TAuthState
	info, err := q.WithContext(ctx).
		Where(q.AccountKey.Eq(accountKey), q.SiteHost.Eq(siteHost)).
		UpdateSimple(q.Status.Value(status), q.UpdatedAt.Value(time.Now().UnixMilli()))
	if err != nil {
		return err
	}
	if info.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}

	return nil
}
