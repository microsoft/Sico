package impl

import (
	"context"
	"errors"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/datatypes"
	"gorm.io/gorm"

	"sico-backend/internal/shared/sitehost"
	"sico-backend/internal/store/casereplay/repository"
	caseReplayRGRPC "sico-backend/internal/transport/reverse_grpc/pb/casereplay"
)

func (s *Service) RpcGetActiveCaseReplay(
	ctx context.Context,
	req *caseReplayRGRPC.GetActiveCaseReplayRequest,
) (*caseReplayRGRPC.GetActiveCaseReplayResponse, error) {
	caseID := strings.TrimSpace(req.GetCaseId())
	siteHost := sitehost.Normalize(req.GetSiteHost())
	platform := normalizePlatform(req.GetPlatform())
	if caseID == "" || siteHost == "" {
		return nil, status.Error(codes.InvalidArgument, "caseId and siteHost are required")
	}

	model, err := s.repository.GetCaseReplay(ctx, caseID, siteHost, platform)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return &caseReplayRGRPC.GetActiveCaseReplayResponse{Found: false}, nil
		}
		return nil, status.Error(codes.Internal, err.Error())
	}

	if model.Status != repository.CaseReplayStatusActive || model.ActiveVersionID <= 0 {
		return &caseReplayRGRPC.GetActiveCaseReplayResponse{
			Found:      false,
			CaseReplay: caseReplayToPB(model),
		}, nil
	}

	version, err := s.repository.GetVersion(ctx, model.ActiveVersionID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return &caseReplayRGRPC.GetActiveCaseReplayResponse{
				Found:      false,
				CaseReplay: caseReplayToPB(model),
			}, nil
		}
		return nil, status.Error(codes.Internal, err.Error())
	}
	if strings.TrimSpace(version.ActionsBlobPath) == "" {
		return &caseReplayRGRPC.GetActiveCaseReplayResponse{
			Found:      false,
			CaseReplay: caseReplayToPB(model),
		}, nil
	}

	return &caseReplayRGRPC.GetActiveCaseReplayResponse{
		Found:         true,
		CaseReplay:    caseReplayToPB(model),
		ActiveVersion: caseReplayVersionToPB(version),
	}, nil
}

func (s *Service) RpcGetOrCreateCaseReplay(
	ctx context.Context,
	req *caseReplayRGRPC.GetOrCreateCaseReplayRequest,
) (*caseReplayRGRPC.GetOrCreateCaseReplayResponse, error) {
	caseID := strings.TrimSpace(req.GetCaseId())
	siteHost := sitehost.Normalize(req.GetSiteHost())
	platform := normalizePlatform(req.GetPlatform())
	if caseID == "" || siteHost == "" {
		return nil, status.Error(codes.InvalidArgument, "caseId and siteHost are required")
	}

	id, created, err := s.repository.GetOrCreate(ctx, caseID, siteHost, platform)
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}

	return &caseReplayRGRPC.GetOrCreateCaseReplayResponse{CaseReplayId: id, Created: created}, nil
}

func (s *Service) RpcCreateCaseReplayVersion(
	ctx context.Context,
	req *caseReplayRGRPC.CreateCaseReplayVersionRequest,
) (*caseReplayRGRPC.CreateCaseReplayVersionResponse, error) {
	if req.GetCaseReplayId() <= 0 {
		return nil, status.Error(codes.InvalidArgument, "caseReplayId is required")
	}
	versionName := strings.TrimSpace(req.GetVersion())
	if versionName == "" {
		return nil, status.Error(codes.InvalidArgument, "version is required")
	}

	metadata := strings.TrimSpace(req.GetMetadata())
	if metadata != "" && !validMetadataJSON(metadata) {
		return nil, status.Error(codes.InvalidArgument, "metadata must be valid JSON")
	}
	version := &repository.CaseReplayVersionModel{
		CaseReplayID:    req.GetCaseReplayId(),
		Version:         versionName,
		ActionsBlobPath: strings.TrimSpace(req.GetActionsBlobPath()),
	}
	if metadata != "" {
		version.Metadata = datatypes.JSON(metadata)
	}
	versionID, err := s.repository.CreateVersion(ctx, version)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, status.Error(codes.NotFound, "case replay not found")
		}
		return nil, status.Error(codes.Internal, err.Error())
	}
	if req.GetActivate() {
		if err := s.repository.ActivateVersion(ctx, req.GetCaseReplayId(), versionID); err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, status.Error(codes.NotFound, "case replay not found")
			}
			return nil, status.Error(codes.Internal, err.Error())
		}
	}

	return &caseReplayRGRPC.CreateCaseReplayVersionResponse{VersionId: versionID}, nil
}

func (s *Service) RpcSetCaseReplayVersionActions(
	ctx context.Context,
	req *caseReplayRGRPC.SetCaseReplayVersionActionsRequest,
) (*caseReplayRGRPC.EmptyCaseReplayResponse, error) {
	if req.GetVersionId() <= 0 {
		return nil, status.Error(codes.InvalidArgument, "versionId is required")
	}
	if err := s.repository.SetVersionActions(
		ctx, req.GetVersionId(), strings.TrimSpace(req.GetActionsBlobPath()),
	); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, status.Error(codes.NotFound, "case replay version not found")
		}
		return nil, status.Error(codes.Internal, err.Error())
	}

	return &caseReplayRGRPC.EmptyCaseReplayResponse{}, nil
}

func (s *Service) RpcActivateCaseReplayVersion(
	ctx context.Context,
	req *caseReplayRGRPC.ActivateCaseReplayVersionRequest,
) (*caseReplayRGRPC.EmptyCaseReplayResponse, error) {
	if req.GetCaseReplayId() <= 0 || req.GetVersionId() <= 0 {
		return nil, status.Error(codes.InvalidArgument, "caseReplayId and versionId are required")
	}

	if err := s.repository.ActivateVersion(ctx, req.GetCaseReplayId(), req.GetVersionId()); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, status.Error(codes.NotFound, "case replay or version not found")
		}
		return nil, status.Error(codes.Internal, err.Error())
	}

	return &caseReplayRGRPC.EmptyCaseReplayResponse{}, nil
}

func (s *Service) RpcMarkCaseReplayStale(
	ctx context.Context,
	req *caseReplayRGRPC.MarkCaseReplayStaleRequest,
) (*caseReplayRGRPC.EmptyCaseReplayResponse, error) {
	if req.GetCaseReplayId() <= 0 {
		return nil, status.Error(codes.InvalidArgument, "caseReplayId is required")
	}

	if err := s.repository.MarkStale(ctx, req.GetCaseReplayId()); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, status.Error(codes.NotFound, "case replay not found")
		}
		return nil, status.Error(codes.Internal, err.Error())
	}

	return &caseReplayRGRPC.EmptyCaseReplayResponse{}, nil
}

func caseReplayToPB(model *repository.CaseReplayModel) *caseReplayRGRPC.CaseReplay {
	return &caseReplayRGRPC.CaseReplay{
		Id:              model.ID,
		CaseId:          model.CaseID,
		SiteHost:        model.SiteHost,
		Platform:        model.Platform,
		ActiveVersionId: model.ActiveVersionID,
		Status:          caseReplayRGRPC.CaseReplayStatus(model.Status),
		CreatedAt:       model.CreatedAt,
		UpdatedAt:       model.UpdatedAt,
	}
}

func caseReplayVersionToPB(
	version *repository.CaseReplayVersionModel,
) *caseReplayRGRPC.CaseReplayVersion {
	return &caseReplayRGRPC.CaseReplayVersion{
		Id:              version.ID,
		CaseReplayId:    version.CaseReplayID,
		Version:         version.Version,
		ActionsBlobPath: version.ActionsBlobPath,
		Metadata:        metadataString(version.Metadata),
		CreatedAt:       version.CreatedAt,
		UpdatedAt:       version.UpdatedAt,
	}
}
