package casereplay

import caseReplayRGRPC "sico-backend/internal/transport/reverse_grpc/pb/casereplay"

type Service interface {
	caseReplayRGRPC.ReverseCaseReplayRPCServer
}

var defaultSvc Service

func Default() Service { return defaultSvc }

func setDefault(service Service) { defaultSvc = service }
