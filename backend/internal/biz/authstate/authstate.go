package authstate

import (
	"context"

	authStateDTO "sico-backend/internal/transport/http/dto/authstate"
	authStateRGRPC "sico-backend/internal/transport/reverse_grpc/pb/authstate"
)

type Service interface {
	authStateRGRPC.ReverseAuthStateRPCServer

	ImportAuthState(
		ctx context.Context,
		req *authStateDTO.ImportAuthStateRequest,
	) (*authStateDTO.ImportAuthStateResponse, error)
	GetAuthState(
		ctx context.Context,
		req *authStateDTO.GetAuthStateRequest,
	) (*authStateDTO.GetAuthStateResponse, error)
	UpdateAuthStateStatus(
		ctx context.Context,
		req *authStateDTO.UpdateAuthStateStatusRequest,
	) (*authStateDTO.UpdateAuthStateStatusResponse, error)
}

var defaultSvc Service

func Default() Service { return defaultSvc }

func setDefault(service Service) { defaultSvc = service }
