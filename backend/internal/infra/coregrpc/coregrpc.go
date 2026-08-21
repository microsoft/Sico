package coregrpc

import (
	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	"sico-backend/internal/consts"
	"sico-backend/pkg/env"
)

type Connection = *grpc.ClientConn

func New() *grpc.ClientConn {
	address := env.MustGet(consts.CoreGRPCAddress)
	conn, err := grpc.NewClient(
		address,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithStatsHandler(otelgrpc.NewClientHandler()),
	)
	if err != nil {
		panic("failed to create core gRPC client: " + err.Error())
	}
	return conn
}
