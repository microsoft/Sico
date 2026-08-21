package dal

import (
	"context"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"sico-backend/internal/store/casereplay/internal/dal/model"
	"sico-backend/internal/store/casereplay/internal/dal/query"
)

const (
	caseReplayStatusUnknown int32 = 0
	caseReplayStatusActive  int32 = 1
	caseReplayStatusStale   int32 = 2
)

type CaseReplayDAO struct {
	query *query.Query
	db    *gorm.DB
}

func NewCaseReplayDAO(db *gorm.DB) *CaseReplayDAO {
	return &CaseReplayDAO{query: query.Use(db), db: db}
}

func (d *CaseReplayDAO) GetCaseReplay(
	ctx context.Context,
	caseID, siteHost, platform string,
) (*model.TCaseReplay, error) {
	q := d.query.TCaseReplay
	return q.WithContext(ctx).
		Where(q.CaseID.Eq(caseID), q.SiteHost.Eq(siteHost), q.Platform.Eq(platform)).
		First()
}

func (d *CaseReplayDAO) GetOrCreate(
	ctx context.Context,
	caseID, siteHost, platform string,
) (int64, bool, error) {
	now := time.Now().UnixMilli()
	caseReplay := &model.TCaseReplay{
		CaseID:    caseID,
		SiteHost:  siteHost,
		Platform:  platform,
		CreatedAt: now,
		UpdatedAt: now,
	}

	result := d.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "case_id"}, {Name: "site_host"}, {Name: "platform"}},
		DoUpdates: clause.Set{
			{
				Column: clause.Column{Name: "status"},
				Value:  gorm.Expr("IF(deleted_at IS NULL, status, ?)", caseReplayStatusUnknown),
			},
			{
				Column: clause.Column{Name: "active_version_id"},
				Value:  gorm.Expr("IF(deleted_at IS NULL, active_version_id, 0)"),
			},
			{
				Column: clause.Column{Name: "updated_at"},
				Value:  gorm.Expr("IF(deleted_at IS NULL, updated_at, ?)", now),
			},
			{
				Column: clause.Column{Name: "deleted_at"},
				Value:  gorm.Expr("NULL"),
			},
		},
	}).Create(caseReplay)
	if result.Error != nil {
		return 0, false, result.Error
	}

	created := result.RowsAffected == 1
	existing, err := d.GetCaseReplay(ctx, caseID, siteHost, platform)
	if err != nil {
		return 0, false, err
	}

	return existing.ID, created, nil
}

func (d *CaseReplayDAO) CreateVersion(ctx context.Context, version *model.TCaseReplayVersion) (int64, error) {
	now := time.Now().UnixMilli()
	version.CreatedAt = now
	version.UpdatedAt = now
	err := d.query.Transaction(func(tx *query.Query) error {
		caseReplayQuery := tx.TCaseReplay
		if _, err := caseReplayQuery.WithContext(ctx).
			Where(caseReplayQuery.ID.Eq(version.CaseReplayID)).
			First(); err != nil {
			return err
		}
		return tx.TCaseReplayVersion.WithContext(ctx).Create(version)
	})
	if err != nil {
		return 0, err
	}

	return version.ID, nil
}

func (d *CaseReplayDAO) SetVersionActions(
	ctx context.Context,
	versionID int64,
	actionsBlobPath string,
) error {
	q := d.query.TCaseReplayVersion
	info, err := q.WithContext(ctx).
		Where(q.ID.Eq(versionID)).
		UpdateSimple(q.ActionsBlobPath.Value(actionsBlobPath), q.UpdatedAt.Value(time.Now().UnixMilli()))
	if err != nil {
		return err
	}
	if info.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}

	return nil
}

func (d *CaseReplayDAO) GetVersion(
	ctx context.Context,
	versionID int64,
) (*model.TCaseReplayVersion, error) {
	q := d.query.TCaseReplayVersion
	return q.WithContext(ctx).Where(q.ID.Eq(versionID)).First()
}

func (d *CaseReplayDAO) ActivateVersion(
	ctx context.Context,
	caseReplayID, versionID int64,
) error {
	return d.query.Transaction(func(tx *query.Query) error {
		versionQuery := tx.TCaseReplayVersion
		if _, err := versionQuery.WithContext(ctx).
			Where(versionQuery.ID.Eq(versionID), versionQuery.CaseReplayID.Eq(caseReplayID)).
			First(); err != nil {
			return err
		}

		caseReplayQuery := tx.TCaseReplay
		info, err := caseReplayQuery.WithContext(ctx).
			Where(caseReplayQuery.ID.Eq(caseReplayID)).
			UpdateSimple(
				caseReplayQuery.ActiveVersionID.Value(versionID),
				caseReplayQuery.Status.Value(caseReplayStatusActive),
				caseReplayQuery.UpdatedAt.Value(time.Now().UnixMilli()),
			)
		if err != nil {
			return err
		}
		if info.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}

		return nil
	})
}

func (d *CaseReplayDAO) MarkStale(ctx context.Context, caseReplayID int64) error {
	q := d.query.TCaseReplay
	info, err := q.WithContext(ctx).
		Where(q.ID.Eq(caseReplayID)).
		UpdateSimple(q.Status.Value(caseReplayStatusStale), q.UpdatedAt.Value(time.Now().UnixMilli()))
	if err != nil {
		return err
	}
	if info.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}

	return nil
}
