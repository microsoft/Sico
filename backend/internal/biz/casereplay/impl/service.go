package impl

import (
	"encoding/json"
	"strings"

	"gorm.io/datatypes"

	"sico-backend/internal/store/casereplay/repository"
	caseReplayRGRPC "sico-backend/internal/transport/reverse_grpc/pb/casereplay"
)

type Service struct {
	caseReplayRGRPC.UnimplementedReverseCaseReplayRPCServer
	repository repository.CaseReplayRepository
}

func NewService(repository repository.CaseReplayRepository) *Service {
	return &Service{repository: repository}
}

func normalizePlatform(raw string) string {
	platform := strings.ToLower(strings.TrimSpace(raw))
	if platform == "" {
		return "windows"
	}

	return platform
}

func metadataString(metadata datatypes.JSON) string {
	if len(metadata) == 0 {
		return ""
	}

	return string(metadata)
}

func validMetadataJSON(metadata string) bool {
	return json.Valid([]byte(metadata))
}
