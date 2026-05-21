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

const extractSkillTimeout = 30 * time.Second

type Components struct {
	SkillRepo   repository.SkillRepository
	ProjectRepo projectrepo.ProjectRepository
	CoreGRPC    coregrpc.Connection
}

type Service struct {
	*Components
	grpcClient skillgrpc.SkillServiceClient
}

func NewService(c *Components) *Service {
	svc := &Service{Components: c}
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
		ProjectID:       req.ProjectId,
		AgentID:         req.AgentId,
		AssetID:         req.AssetId,
		Status:          statusToDB(skill.SkillStatus_SKILL_STATUS_UPLOADING),
		CreatorUsername: creator,
	}

	id, err := s.SkillRepo.Create(ctx, rec)
	if err != nil {
		return nil, err
	}

	rec.ID = id
	s.extractAndUpdateSkill(ctx, rec)

	// Re-read to get updated status/name/description
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
			Skill: skillModelToDTO(rec),
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

	rec.AssetID = req.AssetId
	rec.Status = statusToDB(skill.SkillStatus_SKILL_STATUS_UPLOADING)
	rec.FailReason = ""

	if err := s.SkillRepo.Update(ctx, rec); err != nil {
		return nil, err
	}

	s.extractAndUpdateSkill(ctx, rec)
	rec, _ = s.SkillRepo.GetByID(ctx, req.Id)

	return appresp.Success(&skill.UpdateSkillResponse{
		Data: &skill.UpdateSkillData{Skill: skillModelToDTO(rec)},
	}), nil
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

	return appresp.Success(&skill.ListSkillResponse{
		Data: &skill.ListSkillData{
			Skills:  result,
			Total:   int32(total),
			HasNext: int64(offset+int(req.PageSize)) < total,
		},
	}), nil
}

func (s *Service) GetSkillDetails(
	ctx context.Context, req *skill.GetSkillDetailsRequest,
) (*skill.GetSkillDetailsResponse, error) {
	rec, err := s.SkillRepo.GetByID(ctx, req.Id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperr.New(errcode.CommonNotFound, "skill not found")
		}
		return nil, err
	}

	if s.grpcClient == nil {
		return nil, apperr.New(errcode.CommonUnavailable, "core gRPC client not initialized")
	}

	if rec.Status != statusToDB(skill.SkillStatus_SKILL_STATUS_UPLOADED) {
		return nil, apperr.New(errcode.CommonInvalidParam, "skill not yet uploaded")
	}

	grpcReq := &skillgrpc.GetSkillDetailsGrpcRequest{
		SkillId:   rec.ID,
		ProjectId: rec.ProjectID,
		AgentId:   rec.AgentID,
	}

	resp, err := s.grpcClient.GetSkillDetails(ctx, grpcReq)
	if err != nil {
		return nil, err
	}
	if resp == nil {
		return nil, apperr.New(errcode.CommonInternalError, "empty response from core skill service")
	}
	if resp.Code != 0 {
		msg := resp.Msg
		if msg == "" {
			msg = "failed to fetch skill details"
		}
		return nil, apperr.New(errcode.CommonInternalError, msg)
	}

	files := make([]*skill.SkillFile, 0, len(resp.Files))
	for _, f := range resp.Files {
		files = append(files, &skill.SkillFile{
			Path:    f.Path,
			Content: f.Content,
		})
	}

	return appresp.Success(&skill.GetSkillDetailsResponse{
		Data: &skill.GetSkillDetailsData{Files: files},
	}), nil
}

// ---------- Extraction ----------

func (s *Service) extractAndUpdateSkill(ctx context.Context, rec *repository.SkillModel) {
	if rec == nil || rec.ID == 0 || s.grpcClient == nil {
		return
	}

	downloadURL, err := s.buildDownloadURL(ctx, rec)
	if err != nil || downloadURL == "" {
		logger.CtxWarn(ctx, "skill: failed to build download URL: id=%d err=%v", rec.ID, err)
		s.updateSkillRecord(ctx, rec.ID, skill.SkillStatus_SKILL_STATUS_FAILED, "failed to build download URL", "", "")
		return
	}

	reqCtx, cancel := context.WithTimeout(ctx, extractSkillTimeout)
	defer cancel()

	req := &skillgrpc.ExtractSkillRequest{
		SkillId:     rec.ID,
		ProjectId:   rec.ProjectID,
		AgentId:     rec.AgentID,
		DownloadUrl: downloadURL,
	}
	resp, err := s.grpcClient.ExtractSkill(reqCtx, req)
	if err != nil {
		failReason := err.Error()
		logger.CtxWarn(ctx, "skill: gRPC extract skill failed: id=%d err=%v", rec.ID, err)
		s.updateSkillRecord(ctx, rec.ID, skill.SkillStatus_SKILL_STATUS_FAILED, failReason, "", "")
		return
	}

	if resp == nil || resp.Code != 0 {
		failReason := "skill extraction failed"
		if resp != nil && resp.Message != "" {
			failReason = resp.Message
		}
		s.updateSkillRecord(ctx, rec.ID, skill.SkillStatus_SKILL_STATUS_FAILED, failReason, "", "")
		return
	}

	s.updateSkillRecord(ctx, rec.ID, skill.SkillStatus_SKILL_STATUS_UPLOADED, "", resp.Name, resp.Description)
}

func (s *Service) updateSkillRecord(
	ctx context.Context,
	skillID int64, status skill.SkillStatus,
	failReason string, name string, description string,
) {
	if s.SkillRepo == nil {
		return
	}
	rec, err := s.SkillRepo.GetByID(ctx, skillID)
	if err != nil {
		return
	}
	rec.Status = statusToDB(status)
	rec.FailReason = failReason
	if name != "" {
		rec.Name = name
	}
	if description != "" {
		rec.Description = description
	}
	if err := s.SkillRepo.Update(ctx, rec); err != nil {
		logger.CtxWarn(ctx, "skill: failed to update status: id=%d err=%v", skillID, err)
	}
}

func (s *Service) buildDownloadURL(ctx context.Context, rec *repository.SkillModel) (string, error) {
	if rec.AssetID == 0 || s.ProjectRepo == nil {
		return "", nil
	}

	asset, err := s.ProjectRepo.GetProjectAsset(ctx, rec.AssetID)
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
		Id:              rec.ID,
		ProjectId:       rec.ProjectID,
		AgentId:         rec.AgentID,
		Name:            rec.Name,
		Description:     rec.Description,
		AssetId:         rec.AssetID,
		CreatorUsername: rec.CreatorUsername,
		Status:          statusFromDB(rec.Status),
		FailReason:      rec.FailReason,
		CreatedAt:       rec.CreatedAt,
		UpdatedAt:       rec.UpdatedAt,
	}
}
