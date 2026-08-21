package taskruntime

import taskruntimeRgrpc "sico-backend/internal/transport/reverse_grpc/pb/taskruntime"

// Service is the task runtime persistence contract exposed to Core over reverse gRPC.
type Service interface {
	taskruntimeRgrpc.ReverseTaskRuntimeRPCServer
}
