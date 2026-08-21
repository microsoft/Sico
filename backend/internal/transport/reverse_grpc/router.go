package reverse_grpc

import (
	"google.golang.org/grpc"

	"sico-backend/internal/biz/authstate"
	"sico-backend/internal/biz/casereplay"
	"sico-backend/internal/biz/conversation"
	"sico-backend/internal/biz/knowledge"
	"sico-backend/internal/biz/notification"
	"sico-backend/internal/biz/sandbox"
	sandboxproviders "sico-backend/internal/biz/sandbox/providers"
	"sico-backend/internal/biz/taskruntime"
	authStateRGRPC "sico-backend/internal/transport/reverse_grpc/pb/authstate"
	caseReplayRGRPC "sico-backend/internal/transport/reverse_grpc/pb/casereplay"
	conversationRgrpc "sico-backend/internal/transport/reverse_grpc/pb/conversation"
	knowledgeRgrpc "sico-backend/internal/transport/reverse_grpc/pb/knowledge"
	notificationRgrpc "sico-backend/internal/transport/reverse_grpc/pb/notification"
	sandboxRgrpc "sico-backend/internal/transport/reverse_grpc/pb/sandbox"
	taskruntimeRgrpc "sico-backend/internal/transport/reverse_grpc/pb/taskruntime"
)

func RegisterReverseGRPCServer(grpcServer *grpc.Server, sandboxIntegration sandboxproviders.Integration) {
	// knowledge
	knowledgeSvc := knowledge.Default()
	knowledgeRgrpc.RegisterReverseKnowledgeRPCServer(grpcServer, knowledgeSvc)

	// conversation
	conversationSvc := conversation.Default()
	conversationRgrpc.RegisterReverseConversationRPCServer(grpcServer, conversationSvc)

	// sandbox
	sandboxSvc := sandbox.Default()
	sandboxRgrpc.RegisterReverseSandboxRPCServer(grpcServer, sandboxSvc)

	// task runtime
	taskRuntimeSvc := taskruntime.Default()
	taskruntimeRgrpc.RegisterReverseTaskRuntimeRPCServer(grpcServer, taskRuntimeSvc)

	// notification
	notificationSvc := notification.Default()
	notificationRgrpc.RegisterReverseNotificationRPCServer(grpcServer, notificationSvc)

	authStateRGRPC.RegisterReverseAuthStateRPCServer(grpcServer, authstate.Default())
	caseReplayRGRPC.RegisterReverseCaseReplayRPCServer(grpcServer, casereplay.Default())

	sandboxIntegration.RegisterReverseGRPCServices(grpcServer)
}
