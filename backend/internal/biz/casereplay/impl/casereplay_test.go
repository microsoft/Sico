package impl

import (
	"context"
	"errors"
	"testing"

	"google.golang.org/grpc/status"

	"sico-backend/internal/store/casereplay/repository"
	caseReplayRGRPC "sico-backend/internal/transport/reverse_grpc/pb/casereplay"
)

type fakeCaseReplayRepository struct {
	getFn               func(context.Context, string, string, string) (*repository.CaseReplayModel, error)
	getOrCreateFn       func(context.Context, string, string, string) (int64, bool, error)
	getVersionFn        func(context.Context, int64) (*repository.CaseReplayVersionModel, error)
	createVersionFn     func(context.Context, *repository.CaseReplayVersionModel) (int64, error)
	setVersionActionsFn func(context.Context, int64, string) error
	activateVersionFn   func(context.Context, int64, int64) error
	markStaleFn         func(context.Context, int64) error
}

func (repository *fakeCaseReplayRepository) GetCaseReplay(
	ctx context.Context,
	caseID, siteHost, platform string,
) (*repository.CaseReplayModel, error) {
	return repository.getFn(ctx, caseID, siteHost, platform)
}

func (repository *fakeCaseReplayRepository) GetOrCreate(
	ctx context.Context,
	caseID, siteHost, platform string,
) (int64, bool, error) {
	return repository.getOrCreateFn(ctx, caseID, siteHost, platform)
}

func (repository *fakeCaseReplayRepository) GetVersion(
	ctx context.Context,
	versionID int64,
) (*repository.CaseReplayVersionModel, error) {
	return repository.getVersionFn(ctx, versionID)
}

func (repository *fakeCaseReplayRepository) CreateVersion(
	ctx context.Context,
	version *repository.CaseReplayVersionModel,
) (int64, error) {
	return repository.createVersionFn(ctx, version)
}

func (repository *fakeCaseReplayRepository) SetVersionActions(
	ctx context.Context,
	versionID int64,
	actionsBlobPath string,
) error {
	return repository.setVersionActionsFn(ctx, versionID, actionsBlobPath)
}

func (repository *fakeCaseReplayRepository) ActivateVersion(
	ctx context.Context,
	caseReplayID, versionID int64,
) error {
	return repository.activateVersionFn(ctx, caseReplayID, versionID)
}

func (repository *fakeCaseReplayRepository) MarkStale(ctx context.Context, caseReplayID int64) error {
	return repository.markStaleFn(ctx, caseReplayID)
}

func TestSetCaseReplayVersionActionsMatchesDWPMutableBehavior(t *testing.T) {
	t.Parallel()

	const arbitraryPath = "https://example.invalid/actions.json"
	var storedPath string
	service := NewService(&fakeCaseReplayRepository{
		setVersionActionsFn: func(_ context.Context, _ int64, actionsBlobPath string) error {
			storedPath = actionsBlobPath
			return nil
		},
	})
	if _, err := service.RpcSetCaseReplayVersionActions(
		context.Background(),
		&caseReplayRGRPC.SetCaseReplayVersionActionsRequest{
			VersionId:       7,
			ActionsBlobPath: arbitraryPath,
		},
	); err != nil {
		t.Fatalf("set actions: %v", err)
	}
	if storedPath != arbitraryPath {
		t.Fatalf("stored path = %q", storedPath)
	}
}

func TestCaseReplayRPCInternalErrorMatchesDWPBehavior(t *testing.T) {
	t.Parallel()

	service := NewService(&fakeCaseReplayRepository{
		getOrCreateFn: func(context.Context, string, string, string) (int64, bool, error) {
			return 0, false, errors.New("database detail")
		},
	})
	_, err := service.RpcGetOrCreateCaseReplay(
		context.Background(),
		&caseReplayRGRPC.GetOrCreateCaseReplayRequest{
			CaseId:   "case",
			SiteHost: "example.com",
			Platform: "windows",
		},
	)
	if status.Convert(err).Message() != "database detail" {
		t.Fatalf("RPC error = %v", err)
	}
}
