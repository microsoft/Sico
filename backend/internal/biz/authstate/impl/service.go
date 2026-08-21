package impl

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"

	"gorm.io/datatypes"

	"sico-backend/internal/infra/storage"
	"sico-backend/internal/store/authstate/repository"
	authStateRGRPC "sico-backend/internal/transport/reverse_grpc/pb/authstate"
)

type Components struct {
	AuthStateRepo repository.AuthStateRepository
	Storage       storage.Storage
}

type Service struct {
	authStateRGRPC.UnimplementedReverseAuthStateRPCServer
	*Components
}

func NewService(components *Components) *Service {
	return &Service{Components: components}
}

func authStateBlobPath(accountKey, siteHost string) string {
	sum := sha256.Sum256([]byte(accountKey + "|" + siteHost))
	return "auth-state/" + hex.EncodeToString(sum[:16]) + "/storageState.json"
}

func metadataString(metadata datatypes.JSON) string {
	if len(metadata) == 0 {
		return ""
	}

	return string(metadata)
}

func isWritableAuthStatus(status int32) bool {
	return status == repository.AuthStateStatusValid ||
		status == repository.AuthStateStatusExpired ||
		status == repository.AuthStateStatusDisabled
}

func validMetadataJSON(metadata string) bool {
	return json.Valid([]byte(metadata))
}

func deriveExpiresAtMs(storageState string) int64 {
	var state struct {
		Cookies []struct {
			Expires float64 `json:"expires"`
		} `json:"cookies"`
	}
	if json.Unmarshal([]byte(storageState), &state) != nil {
		return 0
	}

	var earliest float64
	for _, cookie := range state.Cookies {
		if cookie.Expires <= 0 {
			continue
		}
		if earliest == 0 || cookie.Expires < earliest {
			earliest = cookie.Expires
		}
	}
	if earliest <= 0 {
		return 0
	}

	return int64(earliest * 1000)
}
