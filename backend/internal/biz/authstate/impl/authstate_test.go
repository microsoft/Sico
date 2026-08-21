package impl

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	"google.golang.org/grpc/status"
	"gorm.io/gorm"

	"sico-backend/internal/infra/storage"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/errcode"
	"sico-backend/internal/store/authstate/repository"
	"sico-backend/internal/transport/http/dto/authstate"
	authStateRGRPC "sico-backend/internal/transport/reverse_grpc/pb/authstate"
)

type fakeAuthStateRepository struct {
	getFn          func(context.Context, string, string) (*repository.AuthStateModel, error)
	upsertFn       func(context.Context, *repository.AuthStateModel) (int64, error)
	updateStatusFn func(context.Context, string, string, int32) error
}

func (repository *fakeAuthStateRepository) GetByAccountSite(
	ctx context.Context,
	accountKey, siteHost string,
) (*repository.AuthStateModel, error) {
	return repository.getFn(ctx, accountKey, siteHost)
}

func (repository *fakeAuthStateRepository) Upsert(
	ctx context.Context,
	model *repository.AuthStateModel,
) (int64, error) {
	return repository.upsertFn(ctx, model)
}

func (repository *fakeAuthStateRepository) UpdateStatus(
	ctx context.Context,
	accountKey, siteHost string,
	status int32,
) error {
	return repository.updateStatusFn(ctx, accountKey, siteHost, status)
}

type fakeStorage struct {
	putFn func(context.Context, string, []byte) (string, error)
}

func (storage *fakeStorage) PutObject(
	ctx context.Context,
	objectKey string,
	content []byte,
	_ ...storage.PutOptFn,
) (string, error) {
	return storage.putFn(ctx, objectKey, content)
}

func (*fakeStorage) UploadObject(
	context.Context,
	string,
	io.Reader,
	...storage.PutOptFn,
) (*storage.UploadedObject, error) {
	panic("unexpected UploadObject call")
}

func (*fakeStorage) CreateUploadURL(
	context.Context,
	string,
	...storage.PutOptFn,
) (*storage.UploadURL, error) {
	panic("unexpected CreateUploadURL call")
}

func (*fakeStorage) GetObject(
	context.Context,
	string,
	...storage.GetOptFn,
) ([]byte, error) {
	panic("unexpected GetObject call")
}

func (*fakeStorage) GetObjectInfo(
	context.Context,
	string,
	...storage.GetOptFn,
) (*storage.ObjectInfo, error) {
	panic("unexpected GetObjectInfo call")
}

func (*fakeStorage) DeleteObject(
	context.Context,
	string,
	...storage.DelOptFn,
) error {
	panic("unexpected DeleteObject call")
}

func (*fakeStorage) GetObjectUrl(
	context.Context,
	string,
	...storage.GetOptFn,
) (string, error) {
	panic("unexpected GetObjectUrl call")
}

func (*fakeStorage) GetObjectUrlByPath(context.Context, string) (string, error) {
	panic("unexpected GetObjectUrlByPath call")
}

func (*fakeStorage) DelObjectByPath(context.Context, string) error {
	panic("unexpected DelObjectByPath call")
}

func newTestService(repository repository.AuthStateRepository, objectStorage storage.Storage) *Service {
	return NewService(&Components{AuthStateRepo: repository, Storage: objectStorage})
}

func TestImportAuthStateMatchesDWPBehavior(t *testing.T) {
	t.Parallel()

	const storageState = "not-json-but-non-empty"
	var storedModel *repository.AuthStateModel
	var storedKey string
	service := newTestService(
		&fakeAuthStateRepository{
			upsertFn: func(_ context.Context, model *repository.AuthStateModel) (int64, error) {
				storedModel = model
				return 42, nil
			},
		},
		&fakeStorage{putFn: func(_ context.Context, key string, content []byte) (string, error) {
			storedKey = key
			if string(content) != storageState {
				t.Fatalf("stored content = %q", content)
			}
			return "storage-prefix/" + key, nil
		}},
	)

	response, err := service.ImportAuthState(context.Background(), &authstate.ImportAuthStateRequest{
		AccountKey:   " Alice@Example.com ",
		SiteHost:     "https://Copilot.Microsoft.com/path",
		StorageState: storageState,
	})
	if err != nil {
		t.Fatalf("import auth state: %v", err)
	}
	if response.GetCode() != 0 || response.GetData().GetId() != 42 {
		t.Fatalf("response = %+v", response)
	}
	if storedModel.AccountKey != "Alice@Example.com" || storedModel.SiteHost != "copilot.microsoft.com" {
		t.Fatalf("stored identity = %q/%q", storedModel.AccountKey, storedModel.SiteHost)
	}
	if storedModel.StateBlobPath != storedKey {
		t.Fatalf("stored path = %q, want object key %q", storedModel.StateBlobPath, storedKey)
	}
	if !strings.HasSuffix(storedKey, "/storageState.json") {
		t.Fatalf("stable object key = %q", storedKey)
	}
}

func TestRPCInternalErrorMatchesDWPBehavior(t *testing.T) {
	t.Parallel()

	service := newTestService(
		&fakeAuthStateRepository{
			getFn: func(context.Context, string, string) (*repository.AuthStateModel, error) {
				return nil, errors.New("database detail")
			},
		},
		&fakeStorage{},
	)
	_, err := service.RpcGetAuthState(context.Background(), &authStateRGRPC.GetAuthStateRequest{
		AccountKey: "Alice@Example.com",
		SiteHost:   "example.com",
	})
	if status.Convert(err).Message() != "database detail" {
		t.Fatalf("RPC error = %v", err)
	}
}

func TestGetAuthStateUsesNotFoundCode(t *testing.T) {
	t.Parallel()

	service := newTestService(
		&fakeAuthStateRepository{
			getFn: func(context.Context, string, string) (*repository.AuthStateModel, error) {
				return nil, gorm.ErrRecordNotFound
			},
		},
		&fakeStorage{},
	)
	_, err := service.GetAuthState(context.Background(), &authstate.GetAuthStateRequest{
		AccountKey: "Alice@Example.com",
		SiteHost:   "example.com",
	})
	appError, ok := apperr.As(err)
	if !ok || appError.Code() != errcode.AuthStateNotFound {
		t.Fatalf("error = %v, want code %d", err, errcode.AuthStateNotFound)
	}
}

func TestAuthStateHTTPViewOmitsBlobPath(t *testing.T) {
	t.Parallel()

	view := authStateToDTO(&repository.AuthStateModel{StateBlobPath: "default_space/auth-state/private.json"})
	if strings.Contains(strings.ToLower(view.String()), "private") {
		t.Fatal("auth-state HTTP view exposed blob path")
	}
}
