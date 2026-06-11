// Copyright (c) 2026 Sico Authors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

package impl

import (
	"context"
	"errors"
	"testing"

	"google.golang.org/grpc"

	repository "sico-backend/internal/store/skill/repository"
	skillgrpc "sico-backend/internal/transport/grpc/pb/skill"
	"sico-backend/internal/transport/http/dto/skill"
)

func TestSkillVersionModelToDTOConvertsAssetIDToURL(t *testing.T) {
	svc := &Service{
		buildDownloadURLFunc: func(_ context.Context, assetID int64) (string, error) {
			if assetID != 123 {
				t.Fatalf("unexpected asset id: %d", assetID)
			}
			return "https://assets.example/123.zip", nil
		},
	}

	got := svc.skillVersionModelToDTO(context.Background(), &repository.SkillVersionModel{
		ID:      7,
		SkillID: 9,
		Version: "v1",
		AssetID: 123,
	})

	if got.GetUrl() != "https://assets.example/123.zip" {
		t.Fatalf("expected url to be populated, got %q", got.GetUrl())
	}
}

func TestSkillVersionModelToDTOExpandsPartialStorageURL(t *testing.T) {
	t.Setenv("SICO_PUBLIC_ENDPOINT", "http://localhost:8080")
	svc := &Service{
		buildDownloadURLFunc: func(_ context.Context, assetID int64) (string, error) {
			if assetID != 123 {
				t.Fatalf("unexpected asset id: %d", assetID)
			}
			return "/storage/default_space/asset.zip", nil
		},
	}

	got := svc.skillVersionModelToDTO(context.Background(), &repository.SkillVersionModel{
		ID:      7,
		SkillID: 9,
		Version: "v1",
		AssetID: 123,
	})

	if got.GetUrl() != "http://localhost:8080/storage/default_space/asset.zip" {
		t.Fatalf("expected full public url, got %q", got.GetUrl())
	}
}

func TestSkillVersionModelToDTOExpandsInternalStorageURL(t *testing.T) {
	t.Setenv("SICO_PUBLIC_ENDPOINT", "http://localhost:8080")
	svc := &Service{
		buildDownloadURLFunc: func(_ context.Context, assetID int64) (string, error) {
			if assetID != 123 {
				t.Fatalf("unexpected asset id: %d", assetID)
			}
			return "http://sico-seaweedfs-filer:14003/default_space/asset.zip", nil
		},
	}

	got := svc.skillVersionModelToDTO(context.Background(), &repository.SkillVersionModel{
		ID:      7,
		SkillID: 9,
		Version: "v1",
		AssetID: 123,
	})

	if got.GetUrl() != "http://localhost:8080/storage/default_space/asset.zip" {
		t.Fatalf("expected full public url, got %q", got.GetUrl())
	}
}

type fakeSkillRepo struct {
	createVersionCalls int
	createdVersions    []*repository.SkillVersionModel
}

func (f *fakeSkillRepo) Create(context.Context, *repository.SkillModel) (int64, error) { return 0, nil }
func (f *fakeSkillRepo) Update(context.Context, *repository.SkillModel) error          { return nil }
func (f *fakeSkillRepo) GetByID(context.Context, int64) (*repository.SkillModel, error) {
	return nil, errors.New("not implemented")
}
func (f *fakeSkillRepo) List(context.Context, *repository.SkillFilter) ([]*repository.SkillModel, int64, error) {
	return nil, 0, nil
}
func (f *fakeSkillRepo) Delete(context.Context, int64) error { return nil }
func (f *fakeSkillRepo) CreateVersion(_ context.Context, version *repository.SkillVersionModel) (int64, error) {
	f.createVersionCalls++
	f.createdVersions = append(f.createdVersions, version)
	return int64(f.createVersionCalls), nil
}
func (f *fakeSkillRepo) GetLatestVersion(context.Context, int64) (*repository.SkillVersionModel, error) {
	return nil, errors.New("not implemented")
}
func (f *fakeSkillRepo) GetVersion(context.Context, int64, string) (*repository.SkillVersionModel, error) {
	return nil, errors.New("not implemented")
}
func (f *fakeSkillRepo) ListLatestVersionsBySkillIDs(context.Context, []int64) (map[int64]*repository.SkillVersionModel, error) {
	return nil, nil
}
func (f *fakeSkillRepo) ListLatestVersions(context.Context, int64, int) ([]*repository.SkillVersionModel, error) {
	return nil, nil
}
func (f *fakeSkillRepo) DeleteVersions(context.Context, int64) error { return nil }

type fakeSkillGrpcClient struct {
	writeResp *skillgrpc.WriteSkillVersionResponse
	writeErr  error
}

func (f *fakeSkillGrpcClient) ExtractSkill(
	context.Context, *skillgrpc.ExtractSkillRequest, ...grpc.CallOption,
) (*skillgrpc.ExtractSkillResponse, error) {
	return nil, errors.New("not implemented")
}

func (f *fakeSkillGrpcClient) GetSkillDetails(
	context.Context, *skillgrpc.GetSkillDetailsGrpcRequest, ...grpc.CallOption,
) (*skillgrpc.GetSkillDetailsGrpcResponse, error) {
	return nil, errors.New("not implemented")
}

func (f *fakeSkillGrpcClient) DeleteSkillFromFS(
	context.Context, *skillgrpc.DeleteSkillFromFSRequest, ...grpc.CallOption,
) (*skillgrpc.DeleteSkillFromFSResponse, error) {
	return nil, errors.New("not implemented")
}

func (f *fakeSkillGrpcClient) WriteSkillVersion(
	context.Context, *skillgrpc.WriteSkillVersionRequest, ...grpc.CallOption,
) (*skillgrpc.WriteSkillVersionResponse, error) {
	return f.writeResp, f.writeErr
}

func TestWriteManualVersionRejectsInvalidSkillMarkdownWithoutCreatingVersion(t *testing.T) {
	repo := &fakeSkillRepo{}
	svc := &Service{Components: &Components{SkillRepo: repo}, grpcClient: &fakeSkillGrpcClient{}}
	rec := &repository.SkillModel{ID: 283, Name: "ai-3d-model", Description: "existing"}
	source := &repository.SkillVersionModel{Version: "v1", AssetID: 10, Name: "ai-3d-model", Description: "existing"}
	files := []*skill.SkillFile{{
		Path:    "SKILL.md",
		Content: "---\nname: ai-3d-model\ndescription: >\nnot indented\n---\n# Skill\n",
	}}

	_, err := svc.writeManualVersion(context.Background(), rec, source, 0, files, nil, "tester@example.com")
	if err == nil {
		t.Fatal("expected invalid SKILL.md to fail")
	}
	if repo.createVersionCalls != 0 {
		t.Fatalf("CreateVersion calls = %d, want 0", repo.createVersionCalls)
	}
}

func TestWriteManualVersionRejectsCoreActionFailureWithoutCreatingVersion(t *testing.T) {
	repo := &fakeSkillRepo{}
	svc := &Service{
		Components: &Components{SkillRepo: repo},
		grpcClient: &fakeSkillGrpcClient{writeResp: &skillgrpc.WriteSkillVersionResponse{
			Code: 1,
			Msg:  "invalid actions manifest",
		}},
	}
	rec := &repository.SkillModel{ID: 283, Name: "ai-3d-model", Description: "existing"}
	source := &repository.SkillVersionModel{Version: "v1", AssetID: 10, Name: "ai-3d-model", Description: "existing"}
	actions := []*skill.SkillAction{{Name: "run", AdvancedSettings: "{bad json"}}

	_, err := svc.writeManualVersion(context.Background(), rec, source, 0, nil, actions, "tester@example.com")
	if err == nil {
		t.Fatal("expected core action validation failure to fail")
	}
	if repo.createVersionCalls != 0 {
		t.Fatalf("CreateVersion calls = %d, want 0", repo.createVersionCalls)
	}
}
