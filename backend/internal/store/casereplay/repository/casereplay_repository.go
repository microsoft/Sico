package repository

import (
	"context"

	"gorm.io/gorm"

	"sico-backend/internal/store/casereplay/internal/dal"
	caseReplayModel "sico-backend/internal/store/casereplay/internal/dal/model"
)

type CaseReplayModel = caseReplayModel.TCaseReplay
type CaseReplayVersionModel = caseReplayModel.TCaseReplayVersion

const (
	CaseReplayStatusUnknown  int32 = 0
	CaseReplayStatusActive   int32 = 1
	CaseReplayStatusStale    int32 = 2
	CaseReplayStatusDisabled int32 = 3
)

type CaseReplayRepository interface {
	GetCaseReplay(
		ctx context.Context,
		caseID, siteHost, platform string,
	) (*CaseReplayModel, error)
	GetOrCreate(
		ctx context.Context,
		caseID, siteHost, platform string,
	) (int64, bool, error)
	CreateVersion(ctx context.Context, version *CaseReplayVersionModel) (int64, error)
	SetVersionActions(
		ctx context.Context,
		versionID int64,
		actionsBlobPath string,
	) error
	GetVersion(ctx context.Context, versionID int64) (*CaseReplayVersionModel, error)
	ActivateVersion(
		ctx context.Context,
		caseReplayID, versionID int64,
	) error
	MarkStale(ctx context.Context, caseReplayID int64) error
}

func NewCaseReplayRepo(db *gorm.DB) CaseReplayRepository {
	return WithTracingCaseReplayRepository(dal.NewCaseReplayDAO(db))
}
