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
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	"gorm.io/gorm"

	appresp "sico-backend/internal/biz/common/response"
	coregrpc "sico-backend/internal/infra/coregrpc"
	"sico-backend/internal/infra/storage"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/errcode"
	projectrepo "sico-backend/internal/store/project/repository"
	"sico-backend/internal/store/skill/repository"
	skillgrpc "sico-backend/internal/transport/grpc/pb/skill"
	"sico-backend/internal/transport/http/dto/skill"
	"sico-backend/internal/transport/http/middleware"
	"sico-backend/pkg/logger"
)

// 180s average for one try; 3 retries with backoff should be sufficient for most cases.
const extractSkillTimeout = 180 * time.Second

const getSkillVersionLimit = 5

type skillDownloadURLBuilder func(ctx context.Context, assetID int64) (string, error)

type Components struct {
	SkillRepo   repository.SkillRepository
	ProjectRepo projectrepo.ProjectRepository
	CoreGRPC    coregrpc.Connection
}

type Service struct {
	*Components
	grpcClient           skillgrpc.SkillServiceClient
	buildDownloadURLFunc skillDownloadURLBuilder
}

func NewService(c *Components) *Service {
	svc := &Service{Components: c}
	svc.buildDownloadURLFunc = svc.buildDownloadURL
	if c != nil && c.CoreGRPC != nil {
		svc.grpcClient = skillgrpc.NewSkillServiceClient(c.CoreGRPC)
	}
	return svc
}

// ---------- Status helpers ----------

func statusToDB(s skill.SkillStatus) int32 {
	return int32(s)
}

func statusFromDB(v int32) skill.SkillStatus {
	return skill.SkillStatus(v)
}

// ---------- CRUD ----------

func (s *Service) CreateSkill(ctx context.Context, req *skill.CreateSkillRequest) (*skill.CreateSkillResponse, error) {
	if req.ProjectId == 0 && req.AgentId == "" {
		return nil, apperr.New(errcode.CommonInvalidParam, "one of projectId or agentId is required")
	}
	if req.ProjectId != 0 && req.AgentId != "" {
		return nil, apperr.New(errcode.CommonInvalidParam, "only one of projectId or agentId should be provided")
	}

	creator := middleware.MustGetUsernameFromCtx(ctx)

	rec := &repository.SkillModel{
		ProjectID: req.ProjectId,
		AgentID:   req.AgentId,
	}

	id, err := s.SkillRepo.Create(ctx, rec)
	if err != nil {
		return nil, err
	}

	rec.ID = id
	version, err := s.extractAndCreateVersion(ctx, rec, req.AssetId, creator)
	if err != nil {
		return nil, err
	}

	if err := s.updateSkillDisplay(ctx, rec.ID, version.Name, version.Description); err != nil {
		return nil, err
	}
	rec, _ = s.SkillRepo.GetByID(ctx, id)

	return appresp.Success(&skill.CreateSkillResponse{
		Data: &skill.CreateSkillData{Skill: skillModelToDTO(rec)},
	}), nil
}

func (s *Service) GetSkill(ctx context.Context, req *skill.GetSkillRequest) (*skill.GetSkillResponse, error) {
	rec, err := s.SkillRepo.GetByID(ctx, req.Id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperr.New(errcode.CommonNotFound, "skill not found")
		}
		return nil, err
	}

	return appresp.Success(&skill.GetSkillResponse{
		Data: &skill.GetSkillData{
			Skill:    skillModelToDTO(rec),
			Versions: s.skillVersionDTOs(ctx, rec),
		},
	}), nil
}

func (s *Service) UpdateSkill(ctx context.Context, req *skill.UpdateSkillRequest) (*skill.UpdateSkillResponse, error) {
	rec, err := s.SkillRepo.GetByID(ctx, req.Id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperr.New(errcode.CommonNotFound, "skill not found")
		}
		return nil, err
	}

	creator := middleware.MustGetUsernameFromCtx(ctx)
	sourceVersion, err := s.validateCurrentVersion(ctx, rec.ID, req.GetCurrentVersion())
	if err != nil {
		return nil, err
	}

	version, err := s.writeManualVersion(ctx, rec, sourceVersion, req.GetAssetId(), req.GetFiles(), req.GetActions(), creator)
	if err != nil {
		return nil, err
	}
	if err := s.updateSkillDisplay(ctx, rec.ID, version.Name, version.Description); err != nil {
		return nil, err
	}

	return appresp.Success(&skill.UpdateSkillResponse{
		Data: &skill.UpdateSkillData{
			SkillId:     rec.ID,
			Version:     version.Version,
			Name:        version.Name,
			Description: version.Description,
			AssetId:     version.AssetID,
		},
	}), nil
}

func (s *Service) validateCurrentVersion(ctx context.Context, skillID int64, currentVersion string) (*repository.SkillVersionModel, error) {
	currentVersion = strings.TrimSpace(currentVersion)
	if currentVersion == "" {
		return nil, apperr.New(errcode.CommonInvalidParam, "currentVersion is required")
	}

	version, err := s.SkillRepo.GetVersion(ctx, skillID, currentVersion)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperr.New(errcode.CommonConflict, "currentVersion does not exist")
		}
		return nil, err
	}
	return version, nil
}

func (s *Service) DeleteSkill(ctx context.Context, req *skill.DeleteSkillRequest) (*skill.DeleteSkillResponse, error) {
	rec, err := s.SkillRepo.GetByID(ctx, req.Id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperr.New(errcode.CommonNotFound, "skill not found")
		}
		return nil, err
	}

	if err := s.SkillRepo.Delete(ctx, req.Id); err != nil {
		return nil, err
	}
	if err := s.SkillRepo.DeleteVersions(ctx, req.Id); err != nil {
		return nil, err
	}

	// Delete skill files from FS via core gRPC; ignore errors if skill doesn't exist in FS.
	if s.grpcClient != nil {
		grpcReq := &skillgrpc.DeleteSkillFromFSRequest{
			SkillId:   rec.ID,
			ProjectId: rec.ProjectID,
			AgentId:   rec.AgentID,
		}
		if _, err := s.grpcClient.DeleteSkillFromFS(ctx, grpcReq); err != nil {
			logger.CtxWarn(ctx, "skill: failed to delete skill from FS: id=%d err=%v", rec.ID, err)
		}
	}

	return appresp.Success(&skill.DeleteSkillResponse{}), nil
}

func (s *Service) ListSkills(ctx context.Context, req *skill.ListSkillRequest) (*skill.ListSkillResponse, error) {
	offset := int(req.Page-1) * int(req.PageSize)
	filter := &repository.SkillFilter{
		ProjectID: req.ProjectId,
		AgentID:   req.AgentId,
		Status:    statusToDB(req.Status),
		Offset:    offset,
		Limit:     int(req.PageSize),
	}

	records, total, err := s.SkillRepo.List(ctx, filter)
	if err != nil {
		return nil, err
	}

	result := make([]*skill.Skill, 0, len(records))
	for _, rec := range records {
		result = append(result, skillModelToDTO(rec))
	}
	s.setLatestVersions(ctx, result)

	return appresp.Success(&skill.ListSkillResponse{
		Data: &skill.ListSkillData{
			Skills:  result,
			Total:   int32(total),
			HasNext: int64(offset+int(req.PageSize)) < total,
		},
	}), nil
}

// ---------- Extraction ----------

func (s *Service) extractAndCreateVersion(
	ctx context.Context,
	rec *repository.SkillModel,
	assetID int64,
	creator string,
) (*repository.SkillVersionModel, error) {
	if rec == nil || rec.ID == 0 {
		return nil, apperr.New(errcode.CommonInvalidParam, "skill is required")
	}
	if s.grpcClient == nil {
		return nil, apperr.New(errcode.CommonUnavailable, "core gRPC client not initialized")
	}

	downloadURL, err := s.skillDownloadURL(ctx, assetID)
	if err != nil || downloadURL == "" {
		logger.CtxWarn(ctx, "skill: failed to build download URL: id=%d err=%v", rec.ID, err)
		return nil, apperr.New(errcode.CommonInvalidParam, "failed to build download URL")
	}

	reqCtx, cancel := context.WithTimeout(ctx, extractSkillTimeout)
	defer cancel()
	versionString := newSkillVersionString()
	req := &skillgrpc.ExtractSkillRequest{
		SkillId:     rec.ID,
		ProjectId:   rec.ProjectID,
		AgentId:     rec.AgentID,
		DownloadUrl: downloadURL,
		Version:     versionString,
	}
	resp, err := s.grpcClient.ExtractSkill(reqCtx, req)
	if err != nil {
		logger.CtxWarn(ctx, "skill: gRPC extract skill failed: id=%d err=%v", rec.ID, err)
		return nil, err
	}
	if resp == nil || resp.Code != 0 {
		failReason := "skill extraction failed"
		if resp != nil && resp.Message != "" {
			failReason = resp.Message
		}
		return nil, apperr.New(errcode.CommonInternalError, failReason)
	}

	version := &repository.SkillVersionModel{
		SkillID:         rec.ID,
		Version:         versionString,
		AssetID:         assetID,
		Name:            resp.Name,
		Description:     resp.Description,
		CreatorUsername: creator,
		Status:          statusToDB(skill.SkillStatus_SKILL_STATUS_UPLOADED),
	}
	versionID, err := s.SkillRepo.CreateVersion(ctx, version)
	if err != nil {
		return nil, err
	}
	version.ID = versionID
	return version, nil
}

func (s *Service) writeManualVersion(
	ctx context.Context,
	rec *repository.SkillModel,
	sourceVersion *repository.SkillVersionModel,
	assetID int64,
	files []*skill.SkillFile,
	actions []*skill.SkillAction,
	creator string,
) (*repository.SkillVersionModel, error) {
	if err := s.validateManualVersionRequest(sourceVersion, assetID, files, actions); err != nil {
		return nil, err
	}
	name, description, err := skillVersionMetadata(sourceVersion, files)
	if err != nil {
		return nil, err
	}

	if assetID == 0 && len(files) == 0 {
		assetID = sourceVersion.AssetID
	}
	downloadURL, err := s.manualVersionDownloadURL(ctx, rec, sourceVersion, assetID, files, actions)
	if err != nil {
		return nil, err
	}

	versionString := newSkillVersionString()
	reqCtx, cancel := context.WithTimeout(ctx, extractSkillTimeout)
	defer cancel()
	resp, err := s.grpcClient.WriteSkillVersion(reqCtx, &skillgrpc.WriteSkillVersionRequest{
		SkillId:       rec.ID,
		ProjectId:     rec.ProjectID,
		AgentId:       rec.AgentID,
		Version:       versionString,
		Files:         files,
		Actions:       actions,
		DownloadUrl:   downloadURL,
		SourceVersion: sourceVersion.Version,
		AssetId:       assetID,
	})
	if err != nil {
		return nil, err
	}
	if resp == nil || resp.Code != 0 {
		msg := "failed to write skill version"
		if resp != nil && resp.Msg != "" {
			msg = resp.Msg
		}
		return nil, apperr.New(errcode.CommonInternalError, msg)
	}
	if resp.GetName() != "" {
		name = resp.GetName()
	}
	if resp.GetDescription() != "" {
		description = resp.GetDescription()
	}
	if resp.GetAssetId() != 0 {
		assetID = resp.GetAssetId()
	}
	version := &repository.SkillVersionModel{
		SkillID:         rec.ID,
		Version:         versionString,
		AssetID:         assetID,
		Name:            name,
		Description:     description,
		CreatorUsername: creator,
		Status:          statusToDB(skill.SkillStatus_SKILL_STATUS_UPLOADED),
	}
	versionID, err := s.SkillRepo.CreateVersion(ctx, version)
	if err != nil {
		return nil, err
	}
	version.ID = versionID
	return version, nil
}

func (s *Service) validateManualVersionRequest(
	sourceVersion *repository.SkillVersionModel,
	assetID int64,
	files []*skill.SkillFile,
	actions []*skill.SkillAction,
) error {
	if s.grpcClient == nil {
		return apperr.New(errcode.CommonUnavailable, "core gRPC client not initialized")
	}
	if sourceVersion == nil {
		return apperr.New(errcode.CommonInvalidParam, "sourceVersion is required")
	}
	if assetID == 0 && len(files) == 0 && len(actions) == 0 {
		return apperr.New(errcode.CommonInvalidParam, "assetId, files, or actions are required")
	}
	return nil
}

func skillVersionMetadata(
	sourceVersion *repository.SkillVersionModel,
	files []*skill.SkillFile,
) (string, string, error) {
	if len(files) == 0 {
		return sourceVersion.Name, sourceVersion.Description, nil
	}

	name, description, found, err := skillMetadataFromFiles(files)
	if err != nil {
		return "", "", err
	}
	if !found {
		return sourceVersion.Name, sourceVersion.Description, nil
	}
	return name, description, nil
}

func (s *Service) manualVersionDownloadURL(
	ctx context.Context,
	rec *repository.SkillModel,
	sourceVersion *repository.SkillVersionModel,
	assetID int64,
	files []*skill.SkillFile,
	actions []*skill.SkillAction,
) (string, error) {
	if assetID == sourceVersion.AssetID && len(files) == 0 && len(actions) == 0 {
		logger.CtxInfo(
			ctx,
			"skill: update requested with unchanged asset id: id=%d version=%s asset=%d",
			rec.ID, sourceVersion.Version, assetID,
		)
	}
	if assetID == 0 || len(files) > 0 || len(actions) > 0 {
		return "", nil
	}

	downloadURL, err := s.skillDownloadURL(ctx, assetID)
	if err != nil || downloadURL == "" {
		logger.CtxWarn(ctx, "skill: failed to build download URL: id=%d err=%v", rec.ID, err)
		return "", apperr.New(errcode.CommonInvalidParam, "failed to build download URL")
	}
	return downloadURL, nil
}

func (s *Service) updateSkillDisplay(ctx context.Context, skillID int64, name, description string) error {
	rec, err := s.SkillRepo.GetByID(ctx, skillID)
	if err != nil {
		return err
	}
	rec.Name = name
	rec.Description = description
	return s.SkillRepo.Update(ctx, rec)
}

func (s *Service) skillDownloadURL(ctx context.Context, assetID int64) (string, error) {
	if s.buildDownloadURLFunc != nil {
		return s.buildDownloadURLFunc(ctx, assetID)
	}

	return s.buildDownloadURL(ctx, assetID)
}

func (s *Service) buildDownloadURL(ctx context.Context, assetID int64) (string, error) {
	if assetID == 0 || s.ProjectRepo == nil {
		return "", nil
	}

	asset, err := s.ProjectRepo.GetProjectAsset(ctx, assetID)
	if err != nil {
		return "", err
	}

	uriPath := fmt.Sprintf("%s/%s", asset.ProjectID, asset.ObjectKey)
	sasURL, err := storage.PathToUrl(uriPath)
	if err != nil {
		return "", err
	}
	return sasURL, nil
}

func skillModelToDTO(rec *repository.SkillModel) *skill.Skill {
	if rec == nil {
		return nil
	}

	return &skill.Skill{
		Id:          rec.ID,
		ProjectId:   rec.ProjectID,
		AgentId:     rec.AgentID,
		Name:        rec.Name,
		Description: rec.Description,
		CreatedAt:   rec.CreatedAt,
		UpdatedAt:   rec.UpdatedAt,
	}
}

func (s *Service) setLatestVersions(ctx context.Context, skills []*skill.Skill) {
	skillIDs := make([]int64, 0, len(skills))
	for _, item := range skills {
		if item != nil && item.Id != 0 {
			skillIDs = append(skillIDs, item.Id)
		}
	}
	latestVersions, err := s.SkillRepo.ListLatestVersionsBySkillIDs(ctx, skillIDs)
	if err != nil {
		logger.CtxWarn(ctx, "skill: failed to load latest versions for list: err=%v", err)
		return
	}
	for _, item := range skills {
		if item == nil {
			continue
		}
		if latest := latestVersions[item.Id]; latest != nil {
			item.Version = latest.Version
		}
	}
}

func (s *Service) skillVersionDetails(
	ctx context.Context, rec *repository.SkillModel, requestedVersions []string,
) map[string]*skill.SkillVersion {
	if s.grpcClient == nil || len(requestedVersions) == 0 {
		return nil
	}
	resp, err := s.grpcClient.GetSkillDetails(ctx, &skillgrpc.GetSkillDetailsGrpcRequest{
		SkillId:   rec.ID,
		ProjectId: rec.ProjectID,
		AgentId:   rec.AgentID,
		Versions:  requestedVersions,
	})
	if err != nil || resp == nil || resp.Code != 0 {
		if err != nil {
			logger.CtxWarn(ctx, "skill: failed to load skill details: id=%d err=%v", rec.ID, err)
		}
		return nil
	}
	details := make(map[string]*skill.SkillVersion, len(resp.Versions)+1)
	for _, version := range resp.Versions {
		if version != nil && version.Version != "" {
			details[version.Version] = version
		}
	}
	if resp.Version != nil && resp.Version.Version != "" {
		details[resp.Version.Version] = resp.Version
	}
	return details
}

func (s *Service) skillVersionDTOs(ctx context.Context, rec *repository.SkillModel) []*skill.SkillVersion {
	versions, err := s.SkillRepo.ListLatestVersions(ctx, rec.ID, getSkillVersionLimit)
	if err != nil {
		logger.CtxWarn(ctx, "skill: failed to list versions: id=%d err=%v", rec.ID, err)
		return nil
	}
	items := make([]*skill.SkillVersion, 0, len(versions))
	for _, version := range versions {
		items = append(items, s.skillVersionModelToDTO(ctx, version))
	}

	details := s.skillVersionDetails(ctx, rec, uploadedVersionStrings(versions))
	if len(details) == 0 {
		return items
	}
	for _, item := range items {
		if detail := details[item.Version]; detail != nil {
			mergeSkillVersionDTO(item, detail)
		}
	}
	return items
}

func uploadedVersionStrings(versions []*repository.SkillVersionModel) []string {
	values := make([]string, 0, len(versions))
	for _, version := range versions {
		if version == nil || version.Status != statusToDB(skill.SkillStatus_SKILL_STATUS_UPLOADED) {
			continue
		}
		if strings.TrimSpace(version.Version) == "" {
			continue
		}
		values = append(values, version.Version)
	}
	return values
}

func (s *Service) skillVersionModelToDTO(ctx context.Context, rec *repository.SkillVersionModel) *skill.SkillVersion {
	if rec == nil {
		return nil
	}
	url := ""
	if rec.AssetID != 0 {
		var err error
		url, err = s.skillDownloadURL(ctx, rec.AssetID)
		if err != nil {
			logger.CtxWarn(ctx, "skill: failed to build version download URL: id=%d version=%s asset=%d err=%v", rec.SkillID, rec.Version, rec.AssetID, err)
		}
		url = publicSkillDownloadURL(url)
	}
	return &skill.SkillVersion{
		Id:              rec.ID,
		SkillId:         rec.SkillID,
		Version:         rec.Version,
		Url:             url,
		Name:            rec.Name,
		Description:     rec.Description,
		CreatorUsername: rec.CreatorUsername,
		Status:          statusFromDB(rec.Status),
		FailReason:      rec.FailReason,
		CreatedAt:       rec.CreatedAt,
		UpdatedAt:       rec.UpdatedAt,
	}
}

func publicSkillDownloadURL(rawURL string) string {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return rawURL
	}
	publicEndpoint := strings.TrimRight(os.Getenv("SICO_PUBLIC_ENDPOINT"), "/")
	if publicEndpoint == "" {
		return rawURL
	}
	if parsed, err := url.Parse(rawURL); err == nil && parsed.Scheme != "" && parsed.Host != "" {
		path := "/" + strings.TrimLeft(parsed.Path, "/")
		if strings.HasPrefix(path, "/storage/") {
			return publicEndpoint + path
		}
		return publicEndpoint + "/storage" + path
	}
	if strings.HasPrefix(rawURL, "/") {
		return publicEndpoint + rawURL
	}
	return publicEndpoint + "/" + strings.TrimLeft(rawURL, "/")
}

func mergeSkillVersionDTO(base, detail *skill.SkillVersion) *skill.SkillVersion {
	if detail == nil {
		return base
	}
	if base == nil {
		return detail
	}
	base.Actions = detail.Actions
	return base
}

func newSkillVersionString() string {
	return fmt.Sprintf("%d", time.Now().UnixMilli())
}

func skillMetadataFromFiles(files []*skill.SkillFile) (string, string, bool, error) {
	for _, file := range files {
		if file == nil || normalizedSkillFilePath(file.GetPath()) != "SKILL.md" {
			continue
		}
		metadata := parseFrontmatter(file.GetContent())
		name := strings.TrimSpace(metadata["name"])
		description := strings.TrimSpace(metadata["description"])
		if name == "" || description == "" {
			return "", "", true, apperr.New(errcode.CommonInvalidParam, "SKILL.md must contain non-empty name and description")
		}
		return name, description, true, nil
	}
	return "", "", false, nil
}

func normalizedSkillFilePath(path string) string {
	path = strings.TrimSpace(strings.ReplaceAll(path, "\\", "/"))
	path = strings.TrimPrefix(path, "original/")
	return path
}

func parseFrontmatter(content string) map[string]string {
	lines := strings.Split(content, "\n")
	result := map[string]string{}
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != "---" {
		return result
	}
	for _, line := range lines[1:] {
		line = strings.TrimSpace(line)
		if line == "---" {
			break
		}
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		result[strings.TrimSpace(key)] = strings.Trim(strings.TrimSpace(value), "\"'")
	}
	return result
}
