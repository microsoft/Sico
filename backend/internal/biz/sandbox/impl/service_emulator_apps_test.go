package impl

import (
	"context"
	"io"
	"strings"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"

	"sico-backend/internal/infra/storage"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/enum"
	"sico-backend/internal/shared/errcode"
	projectrepo "sico-backend/internal/store/project/repository"
	sandboxdto "sico-backend/internal/transport/http/dto/sandbox"
	"sico-backend/internal/transport/http/middleware"
)

type fakeEmulatorAppProvider struct {
	listResponse      *EmulatorAppBatchResponse
	installResponse   *EmulatorAppBatchResponse
	uninstallResponse *EmulatorAppBatchResponse
	resetFn           func(context.Context, string) error
	uninstallFn       func(
		context.Context,
		string,
		[]int,
		string,
		int32,
	) (*EmulatorAppBatchResponse, error)
}

func (*fakeEmulatorAppProvider) Type() string { return enum.SandboxTypeEmulator.String() }

func (*fakeEmulatorAppProvider) ListResources(context.Context) ([]*Resource, error) { return nil, nil }

func (p *fakeEmulatorAppProvider) ResetResource(ctx context.Context, resourceID string) error {
	if p.resetFn != nil {
		return p.resetFn(ctx, resourceID)
	}
	return nil
}

func (*fakeEmulatorAppProvider) ParseResourceIDForProxy(resourceID string) (string, string, error) {
	parts := strings.SplitN(resourceID, "|", 2)
	if len(parts) != 2 {
		return "", "", apperr.New(errcode.CommonInvalidParam, "invalid emulator resource id")
	}
	return parts[0], parts[1], nil
}

func (p *fakeEmulatorAppProvider) ListAppsBatch(
	context.Context,
	string,
	[]int,
	string,
	int32,
) (*EmulatorAppBatchResponse, error) {
	return p.listResponse, nil
}

func (p *fakeEmulatorAppProvider) InstallAppBatch(
	context.Context,
	string,
	[]int,
	string,
	int32,
) (*EmulatorAppBatchResponse, error) {
	return p.installResponse, nil
}

func (p *fakeEmulatorAppProvider) UninstallAppBatch(
	ctx context.Context,
	baseURL string,
	indices []int,
	packageName string,
	maxParallel int32,
) (*EmulatorAppBatchResponse, error) {
	if p.uninstallFn != nil {
		return p.uninstallFn(ctx, baseURL, indices, packageName, maxParallel)
	}
	return p.uninstallResponse, nil
}

type fakeEmulatorAppAssetLookup struct {
	asset *projectrepo.ProjectAssetModel
	err   error
}

func (f *fakeEmulatorAppAssetLookup) GetProjectAssetByObjectKey(
	context.Context,
	string,
	string,
) (*projectrepo.ProjectAssetModel, error) {
	return f.asset, f.err
}

type fakeEmulatorAppStorage struct {
	url string
}

func (*fakeEmulatorAppStorage) PutObject(context.Context, string, []byte, ...storage.PutOptFn) (string, error) {
	return "", nil
}

func (*fakeEmulatorAppStorage) UploadObject(
	context.Context,
	string,
	io.Reader,
	...storage.PutOptFn,
) (*storage.UploadedObject, error) {
	return nil, nil
}

func (*fakeEmulatorAppStorage) CreateUploadURL(
	context.Context,
	string,
	...storage.PutOptFn,
) (*storage.UploadURL, error) {
	return nil, nil
}

func (*fakeEmulatorAppStorage) GetObject(context.Context, string, ...storage.GetOptFn) ([]byte, error) {
	return nil, nil
}

func (*fakeEmulatorAppStorage) GetObjectInfo(
	context.Context,
	string,
	...storage.GetOptFn,
) (*storage.ObjectInfo, error) {
	return nil, nil
}

func (*fakeEmulatorAppStorage) DeleteObject(context.Context, string, ...storage.DelOptFn) error {
	return nil
}

func (f *fakeEmulatorAppStorage) GetObjectUrl(context.Context, string, ...storage.GetOptFn) (string, error) {
	return f.url, nil
}

func (f *fakeEmulatorAppStorage) GetObjectUrlByPath(context.Context, string) (string, error) {
	return f.url, nil
}

func (*fakeEmulatorAppStorage) DelObjectByPath(context.Context, string) error { return nil }

func TestRunEmulatorAppBatchPreservesTargetOrderAndMapsAppFields(t *testing.T) {
	targets := []*emulatorAppTarget{
		{sandboxID: "sandbox-2", baseURL: "http://provider", deviceID: "2", deviceIndex: 2},
		{sandboxID: "sandbox-1", baseURL: "http://provider", deviceID: "1", deviceIndex: 1},
	}

	results := runEmulatorAppBatch(
		targets,
		emulatorAppDeviceStatusSuccess,
		"list apps",
		func(string, []int) (*EmulatorAppBatchResponse, error) {
			return &EmulatorAppBatchResponse{Results: []EmulatorAppBatchDeviceResult{
				{
					Index:  1,
					Status: emulatorAppDeviceStatusSuccess,
					Apps: []*EmulatorAppInfoUpstream{{
						Package: "com.example", AppName: "Example", Version: "1.0", IsSystem: true,
					}},
				},
				{Index: 2, Status: emulatorAppDeviceStatusSuccess},
			}}, nil
		},
	)

	require.Equal(t, []string{"sandbox-2", "sandbox-1"}, []string{results[0].SandboxId, results[1].SandboxId})
	require.Equal(t, "Example", results[1].Apps[0].AppName)
	require.True(t, results[1].Apps[0].IsSystem)
}

func TestResolveEmulatorAppInstallURLExpandsLocalStorageURL(t *testing.T) {
	t.Setenv("STORAGE_TYPE", "seaweedfs")
	t.Setenv("SICO_PUBLIC_ENDPOINT", "http://localhost:8080")
	previousStorage := storage.Default()
	storage.SetDefault(&fakeEmulatorAppStorage{url: "http://seaweedfs-filer:14003/project-1/app.apk"})
	t.Cleanup(func() { storage.SetDefault(previousStorage) })

	service := &Service{ProjectAssets: &fakeEmulatorAppAssetLookup{asset: &projectrepo.ProjectAssetModel{}}}
	got, err := service.resolveEmulatorAppInstallURL(
		context.Background(),
		"/storage/project-1/app.apk",
	)

	require.NoError(t, err)
	require.Equal(t, "http://localhost:8080/storage/project-1/app.apk", got)
}

func TestResolveEmulatorAppInstallURLRejectsUntrustedHost(t *testing.T) {
	t.Setenv("STORAGE_TYPE", "seaweedfs")
	t.Setenv("SICO_PUBLIC_ENDPOINT", "http://localhost:8080")
	previousStorage := storage.Default()
	storage.SetDefault(&fakeEmulatorAppStorage{url: "http://seaweedfs-filer:14003/project-1/app.apk"})
	t.Cleanup(func() { storage.SetDefault(previousStorage) })

	service := &Service{ProjectAssets: &fakeEmulatorAppAssetLookup{asset: &projectrepo.ProjectAssetModel{}}}
	_, err := service.resolveEmulatorAppInstallURL(
		context.Background(),
		"https://example.invalid/project-1/app.apk",
	)

	require.Error(t, err)
}

func TestResolveEmulatorAppInstallURLPreservesAzureCDNURL(t *testing.T) {
	t.Setenv("STORAGE_TYPE", "azure_blob")
	const cdnURL = "https://cdn.example/container/project-1/app.apk"
	previousStorage := storage.Default()
	storage.SetDefault(&fakeEmulatorAppStorage{url: cdnURL})
	t.Cleanup(func() { storage.SetDefault(previousStorage) })

	service := &Service{ProjectAssets: &fakeEmulatorAppAssetLookup{asset: &projectrepo.ProjectAssetModel{}}}
	got, err := service.resolveEmulatorAppInstallURL(context.Background(), cdnURL)

	require.NoError(t, err)
	require.Equal(t, cdnURL, got)
}

func TestGetEmulatorAppInstallTaskEnforcesSubmitterOwnership(t *testing.T) {
	memoryRedis := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: memoryRedis.Addr()})
	service := &Service{Pool: &Pool{rds: rds}}
	taskID := uuid.NewString()
	require.NoError(t, service.saveEmulatorAppInstallTask(
		context.Background(),
		&emulatorAppInstallTaskState{
			TaskID: taskID, Status: emulatorAppStatusPending, SubmitterUserKey: "name:owner",
		},
	))

	otherUserContext := context.WithValue(
		context.Background(),
		middleware.ContextUserKey,
		middleware.UserInfo{Name: "other"},
	)
	_, err := service.GetEmulatorAppInstallTask(otherUserContext, taskID)

	require.Error(t, err)
	appError, ok := apperr.As(err)
	require.True(t, ok)
	require.Equal(t, errcode.CommonNotFound, appError.Code())
}

func TestTryReserveEmulatorAppInstallDedupReturnsExistingTask(t *testing.T) {
	memoryRedis := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: memoryRedis.Addr()})
	service := &Service{Pool: &Pool{rds: rds}}
	const dedupKey = "sandbox:emulator:apps:install:dedup:test"

	require.Equal(t, "task-1", service.tryReserveEmulatorAppInstallDedup(
		context.Background(), dedupKey, "task-1",
	))
	require.Equal(t, "task-1", service.tryReserveEmulatorAppInstallDedup(
		context.Background(), dedupKey, "task-2",
	))
}

func TestEmulatorAppTaskKeyUsesSandboxNamespace(t *testing.T) {
	t.Setenv("APP_ENV", "development")
	require.Equal(
		t,
		"sandbox:env:local:emulator:apps:install:task:task-1",
		emulatorAppInstallTaskKey("task-1"),
	)
}

func TestNormalizeEmulatorAppFilter(t *testing.T) {
	filter, err := normalizeEmulatorAppFilter("")
	require.NoError(t, err)
	require.Equal(t, emulatorAppFilterUser, filter)
	_, err = normalizeEmulatorAppFilter("third_party")
	require.Error(t, err)
}

func TestSummarizeEmulatorAppBatchResultReportsPartial(t *testing.T) {
	result := &sandboxdto.EmulatorAppBatchResult{Results: []*sandboxdto.EmulatorAppDeviceResult{
		{Status: emulatorAppDeviceStatusInstalled},
		{Status: emulatorAppDeviceStatusFailed},
	}}

	succeeded := summarizeEmulatorAppBatchResult(result, emulatorAppDeviceStatusInstalled)

	require.Equal(t, int32(1), succeeded)
	require.Equal(t, emulatorAppStatusPartial, result.Status)
}
