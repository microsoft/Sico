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

package seeds

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"mime/multipart"

	"sico-backend/internal/di"
	"sico-backend/internal/infra/storage"
	"sico-backend/internal/shared/types"
	projectrepo "sico-backend/internal/store/project/repository"
	projectdto "sico-backend/internal/transport/http/dto/project"
	"sico-backend/pkg/logger"
)

// ensureAsset uploads `file` as a project asset under `projectID`, deduplicating
// against existing assets that share the same FileName + SHA-256 digest. The
// SHA-256 in `extra` is computed automatically when empty. Returns the
// asset's database ID and storage URI ("<projectId>/<objectKey>").
//
// `projectID` may be empty: in that case the asset is uploaded with no project
// scope and dedup is performed against other unscoped assets sharing the same
// FileName.
func ensureAsset(
	ctx context.Context,
	injector *di.Injector,
	projectID string,
	file multipart.File,
	extra types.FileExtraInfo,
) (int64, string, error) {
	if injector == nil || injector.ProjectApp == nil {
		return 0, "", errors.New("ensureAsset: project service not initialized")
	}
	if file == nil {
		return 0, "", errors.New("ensureAsset: file is nil")
	}
	if extra.FileName == "" {
		return 0, "", errors.New("ensureAsset: FileName is required")
	}

	// Read full content so we can hash it and re-feed the upload path.
	content, err := readAll(file)
	if err != nil {
		return 0, "", fmt.Errorf("ensureAsset: read content: %w", err)
	}
	if len(content) == 0 {
		return 0, "", fmt.Errorf("ensureAsset: %s is empty", extra.FileName)
	}

	if extra.SHA256 == "" {
		sum := sha256.Sum256(content)
		extra.SHA256 = hex.EncodeToString(sum[:])
	}
	if extra.FileSize == 0 {
		extra.FileSize = int64(len(content))
	}

	// Normalize empty projectID to the storage default. Asset rows persisted
	// from an empty request store the column default ("default_space"), so
	// querying with "" misses them and we'd re-upload on every restart.
	if projectID == "" {
		projectID = storage.DefaultPathPrefix
	}

	repo := projectrepo.NewProjectRepo(injector.DB)
	existing, err := repo.GetProjectAssetList(ctx, projectID)
	if err != nil {
		return 0, "", fmt.Errorf("ensureAsset: list existing assets: %w", err)
	}

	if id, uri, ok := findReusableAsset(ctx, existing, extra); ok {
		return id, uri, nil
	}

	resp, err := injector.ProjectApp.AddProjectAsset(
		ctx,
		&projectdto.AddProjectAssetRequest{ProjectId: projectID},
		defaultSystemUser,
		embeddedFile{bytes.NewReader(content)},
		extra,
	)
	if err != nil {
		return 0, "", fmt.Errorf("ensureAsset: upload %s: %w", extra.FileName, err)
	}

	id := resp.GetData().GetId()
	uri := resp.GetData().GetUri()
	logger.CtxInfo(ctx, "ensureAsset: uploaded %s -> id=%d uri=%s", extra.FileName, id, uri)
	return id, uri, nil
}

// findReusableAsset scans `existing` for an asset that matches `extra` by
// FileName and SHA-256 (treating an empty stored hash as a match). Returns
// the asset id, storage URI, and true when a reusable asset is found.
func findReusableAsset(
	ctx context.Context,
	existing []*projectrepo.ProjectAssetModel,
	extra types.FileExtraInfo,
) (int64, string, bool) {
	for _, asset := range existing {
		if asset == nil || asset.Extra == "" {
			continue
		}
		var meta types.FileExtraInfo
		if jsonErr := json.Unmarshal([]byte(asset.Extra), &meta); jsonErr != nil {
			logger.CtxWarn(ctx, "ensureAsset: failed to unmarshal asset extra (id=%d): %v", asset.ID, jsonErr)
			continue
		}
		if meta.FileName != extra.FileName {
			continue
		}
		// Reuse when the recorded hash matches, or when the asset predates
		// hash tracking (empty hash) — we don't want to churn legacy rows on
		// first upgrade.
		if meta.SHA256 == "" || meta.SHA256 == extra.SHA256 {
			uri := fmt.Sprintf("%s/%s", asset.ProjectID, asset.ObjectKey)
			return asset.ID, uri, true
		}
		logger.CtxInfo(ctx,
			"ensureAsset: %s content changed (old=%s new=%s); re-uploading",
			extra.FileName, meta.SHA256, extra.SHA256)
	}
	return 0, "", false
}

// readAll reads the entire content of a multipart.File. It rewinds the
// reader first when supported so callers can pass freshly opened files.
func readAll(file multipart.File) ([]byte, error) {
	if seeker, ok := file.(interface {
		Seek(offset int64, whence int) (int64, error)
	}); ok {
		_, _ = seeker.Seek(0, 0)
	}
	buf := bytes.NewBuffer(nil)
	if _, err := buf.ReadFrom(file); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
