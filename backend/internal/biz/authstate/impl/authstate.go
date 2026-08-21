package impl

import (
	"context"
	"errors"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/datatypes"
	"gorm.io/gorm"

	appresp "sico-backend/internal/biz/common/response"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/errcode"
	"sico-backend/internal/shared/sitehost"
	"sico-backend/internal/store/authstate/repository"
	authStateDTO "sico-backend/internal/transport/http/dto/authstate"
	authStateRGRPC "sico-backend/internal/transport/reverse_grpc/pb/authstate"
)

func (s *Service) ImportAuthState(
	ctx context.Context,
	req *authStateDTO.ImportAuthStateRequest,
) (*authStateDTO.ImportAuthStateResponse, error) {
	accountKey := strings.TrimSpace(req.GetAccountKey())
	siteHost := sitehost.Normalize(req.GetSiteHost())
	if accountKey == "" || siteHost == "" {
		return nil, apperr.New(errcode.CommonInvalidParam, "accountKey and siteHost are required")
	}
	storageState := strings.TrimSpace(req.GetStorageState())
	if storageState == "" {
		return nil, apperr.New(errcode.CommonInvalidParam, "storageState is required")
	}
	metadata := strings.TrimSpace(req.GetMetadata())
	if metadata != "" && !validMetadataJSON(metadata) {
		return nil, apperr.New(errcode.CommonInvalidParam, "metadata must be valid JSON")
	}

	expiresAt := req.GetExpiresAt()
	if expiresAt <= 0 {
		expiresAt = deriveExpiresAtMs(storageState)
	}

	blobPath := authStateBlobPath(accountKey, siteHost)
	if _, err := s.Storage.PutObject(ctx, blobPath, []byte(storageState)); err != nil {
		return nil, apperr.Wrap(errcode.CommonInternalError, "failed to store storageState", err)
	}

	model := &repository.AuthStateModel{
		AccountKey:      accountKey,
		SiteHost:        siteHost,
		StateBlobPath:   blobPath,
		Status:          repository.AuthStateStatusValid,
		ExpiresAt:       expiresAt,
		LastValidatedAt: time.Now().UnixMilli(),
	}
	if metadata != "" {
		model.Metadata = datatypes.JSON(metadata)
	}
	id, err := s.AuthStateRepo.Upsert(ctx, model)
	if err != nil {
		return nil, apperr.Wrap(errcode.CommonInternalError, "failed to upsert auth state", err)
	}

	return appresp.Success(&authStateDTO.ImportAuthStateResponse{
		Data: &authStateDTO.ImportAuthStateData{Id: id},
	}), nil
}

func (s *Service) GetAuthState(
	ctx context.Context,
	req *authStateDTO.GetAuthStateRequest,
) (*authStateDTO.GetAuthStateResponse, error) {
	accountKey := strings.TrimSpace(req.GetAccountKey())
	siteHost := sitehost.Normalize(req.GetSiteHost())
	if accountKey == "" || siteHost == "" {
		return nil, apperr.New(errcode.CommonInvalidParam, "accountKey and siteHost are required")
	}

	model, err := s.AuthStateRepo.GetByAccountSite(ctx, accountKey, siteHost)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperr.New(errcode.AuthStateNotFound, "auth state not found")
		}
		return nil, apperr.Wrap(errcode.CommonInternalError, "failed to get auth state", err)
	}

	return appresp.Success(&authStateDTO.GetAuthStateResponse{
		Data: &authStateDTO.GetAuthStateData{AuthState: authStateToDTO(model)},
	}), nil
}

func (s *Service) UpdateAuthStateStatus(
	ctx context.Context,
	req *authStateDTO.UpdateAuthStateStatusRequest,
) (*authStateDTO.UpdateAuthStateStatusResponse, error) {
	accountKey := strings.TrimSpace(req.GetAccountKey())
	siteHost := sitehost.Normalize(req.GetSiteHost())
	if accountKey == "" || siteHost == "" {
		return nil, apperr.New(errcode.CommonInvalidParam, "accountKey and siteHost are required")
	}

	statusValue := int32(req.GetStatus())
	if !isWritableAuthStatus(statusValue) {
		return nil, apperr.New(errcode.CommonInvalidParam, "status must be VALID, EXPIRED or DISABLED")
	}
	if err := s.AuthStateRepo.UpdateStatus(ctx, accountKey, siteHost, statusValue); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperr.New(errcode.AuthStateNotFound, "auth state not found")
		}
		return nil, apperr.Wrap(errcode.CommonInternalError, "failed to update auth state status", err)
	}

	return appresp.Success(&authStateDTO.UpdateAuthStateStatusResponse{}), nil
}

func (s *Service) RpcGetAuthState(
	ctx context.Context,
	req *authStateRGRPC.GetAuthStateRequest,
) (*authStateRGRPC.GetAuthStateResponse, error) {
	accountKey := strings.TrimSpace(req.GetAccountKey())
	siteHost := sitehost.Normalize(req.GetSiteHost())
	if accountKey == "" || siteHost == "" {
		return nil, status.Error(codes.InvalidArgument, "accountKey and siteHost are required")
	}

	model, err := s.AuthStateRepo.GetByAccountSite(ctx, accountKey, siteHost)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return &authStateRGRPC.GetAuthStateResponse{Found: false}, nil
		}
		return nil, status.Error(codes.Internal, err.Error())
	}

	return &authStateRGRPC.GetAuthStateResponse{Found: true, AuthState: authStateToPB(model)}, nil
}

func (s *Service) RpcUpsertAuthState(
	ctx context.Context,
	req *authStateRGRPC.UpsertAuthStateRequest,
) (*authStateRGRPC.UpsertAuthStateResponse, error) {
	accountKey := strings.TrimSpace(req.GetAccountKey())
	siteHost := sitehost.Normalize(req.GetSiteHost())
	if accountKey == "" || siteHost == "" {
		return nil, status.Error(codes.InvalidArgument, "accountKey and siteHost are required")
	}
	metadata := strings.TrimSpace(req.GetMetadata())
	if metadata != "" && !validMetadataJSON(metadata) {
		return nil, status.Error(codes.InvalidArgument, "metadata must be valid JSON")
	}
	statusValue := int32(req.GetStatus())
	if !isWritableAuthStatus(statusValue) {
		return nil, status.Error(codes.InvalidArgument, "status must be VALID, EXPIRED or DISABLED")
	}
	stateBlobPath := strings.TrimSpace(req.GetStateBlobPath())
	if statusValue == repository.AuthStateStatusValid && stateBlobPath == "" {
		return nil, status.Error(codes.InvalidArgument, "stateBlobPath is required when status is VALID")
	}

	model := &repository.AuthStateModel{
		AccountKey:      accountKey,
		SiteHost:        siteHost,
		StateBlobPath:   stateBlobPath,
		Status:          statusValue,
		ExpiresAt:       req.GetExpiresAt(),
		LastValidatedAt: req.GetLastValidatedAt(),
	}
	if metadata != "" {
		model.Metadata = datatypes.JSON(metadata)
	}
	id, err := s.AuthStateRepo.Upsert(ctx, model)
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}

	return &authStateRGRPC.UpsertAuthStateResponse{Id: id}, nil
}

func (s *Service) RpcMarkAuthStateExpired(
	ctx context.Context,
	req *authStateRGRPC.MarkAuthStateExpiredRequest,
) (*authStateRGRPC.EmptyAuthStateResponse, error) {
	accountKey := strings.TrimSpace(req.GetAccountKey())
	siteHost := sitehost.Normalize(req.GetSiteHost())
	if accountKey == "" || siteHost == "" {
		return nil, status.Error(codes.InvalidArgument, "accountKey and siteHost are required")
	}

	if err := s.AuthStateRepo.UpdateStatus(
		ctx, accountKey, siteHost, repository.AuthStateStatusExpired,
	); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, status.Error(codes.NotFound, "auth state not found")
		}
		return nil, status.Error(codes.Internal, err.Error())
	}

	return &authStateRGRPC.EmptyAuthStateResponse{}, nil
}

func authStateToDTO(model *repository.AuthStateModel) *authStateDTO.AuthState {
	return &authStateDTO.AuthState{
		Id:              model.ID,
		AccountKey:      model.AccountKey,
		SiteHost:        model.SiteHost,
		Status:          authStateDTO.AuthStateStatus(model.Status),
		ExpiresAt:       model.ExpiresAt,
		LastValidatedAt: model.LastValidatedAt,
		Metadata:        metadataString(model.Metadata),
		CreatedAt:       model.CreatedAt,
		UpdatedAt:       model.UpdatedAt,
	}
}

func authStateToPB(model *repository.AuthStateModel) *authStateRGRPC.AuthState {
	return &authStateRGRPC.AuthState{
		Id:              model.ID,
		AccountKey:      model.AccountKey,
		SiteHost:        model.SiteHost,
		StateBlobPath:   model.StateBlobPath,
		Status:          authStateRGRPC.AuthStateStatus(model.Status),
		ExpiresAt:       model.ExpiresAt,
		LastValidatedAt: model.LastValidatedAt,
		Metadata:        metadataString(model.Metadata),
		CreatedAt:       model.CreatedAt,
		UpdatedAt:       model.UpdatedAt,
	}
}
