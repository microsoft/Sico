// @title Sico API
// @version 1.0
// @description Sico AI Agent Platform API
//
// @securityDefinitions.apikey BearerAuth
// @in header
// @name Authorization
// @description Enter your bearer token in the format: Bearer <token>

package main

import (
	"context"
	"flag"
	"fmt"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"google.golang.org/grpc"

	"sico-backend/api/openapi"
	"sico-backend/cmd/sico-server/seeds"
	"sico-backend/internal/consts"
	"sico-backend/internal/di"
	"sico-backend/internal/infra/migration"
	"sico-backend/internal/infra/telemetry"
	"sico-backend/internal/transport/reverse_grpc"
	"sico-backend/internal/transport/router"
	"sico-backend/pkg/env"
	"sico-backend/pkg/logger"
	"sico-backend/pkg/safego"
)

func main() {
	appCtx, cancelApp := context.WithCancel(context.Background())
	defer cancelApp()

	if err := env.LoadDotEnv(""); err != nil {
		logger.Warn("failed to load .env file: %v", err)
	}

	// Configure Gin mode based on APP_ENV. Default to ReleaseMode so that
	// production deployments are safe by default; developers can opt in to
	// DebugMode by setting APP_ENV=development. An explicit GIN_MODE takes
	// precedence so operators can still override per-deployment.
	if _, ok := env.Get("GIN_MODE"); !ok {
		switch env.AppEnv() {
		case env.AppEnvDevelopment:
			gin.SetMode(gin.DebugMode)
		case env.AppEnvTest:
			gin.SetMode(gin.TestMode)
		default:
			gin.SetMode(gin.ReleaseMode)
		}
	}

	logger.Info("Starting DWP Backend application (env=%s, gin_mode=%s)", env.AppEnv(), gin.Mode())
	shutdownTelemetry := initializeTelemetry(appCtx)
	defer shutdownTelemetry()

	// make sure database migrations are applied before starting the server
	migrator := migration.NewMigrator()
	version, err := migrator.Run()
	if err != nil {
		panic(fmt.Sprintf("failed to run migrations: %v", err))
	}
	logger.Info("Database migrations applied successfully, version: %d", version)

	ginEngine := gin.Default()
	// ensure *gin.Context.Value() works for custom type keys.
	ginEngine.ContextWithFallback = true
	openapi.SwaggerInfo.BasePath = "/"

	injector, cleanup, err := di.BuildInjector(appCtx)
	if err != nil {
		panic(fmt.Sprintf("failed to build injector: %v", err))
	}
	if cleanup != nil {
		defer cleanup()
	}

	if err := initializeSandboxAndSeeds(appCtx, injector); err != nil {
		panic(fmt.Sprintf("failed to initialize sandbox and seeds: %v", err))
	}

	port := flag.String("port", "8081", "Port to run the server on")
	flag.Parse()

	address := os.Getenv(consts.ReverseGRPCAddress)
	listener, err := net.Listen("tcp", address)
	if err != nil {
		panic(fmt.Sprintf("failed to listen on %s: %v", address, err))
	}

	grpcServer := grpc.NewServer(
		grpc.StatsHandler(otelgrpc.NewServerHandler()),
		// increase max receive message size
		grpc.MaxRecvMsgSize(consts.GRPCMaxRecvMsgSize),
		grpc.MaxSendMsgSize(consts.GRPCMaxSendMsgSize),
	)
	reverse_grpc.RegisterReverseGRPCServer(grpcServer, injector.SandboxIntegration)
	router.RegisterAPIs(ginEngine, injector.SandboxIntegration)

	safego.Go(context.Background(), func() {
		logger.Info("Starting reverse gRPC server on %s", address)
		if err := grpcServer.Serve(listener); err != nil {
			logger.Error("Reverse gRPC server stopped: %v", err)
		}
	})

	// Setup graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	// Start HTTP server in a goroutine
	safego.Go(context.Background(), func() {
		logger.Info("Starting HTTP server on port %s", *port)
		if err := ginEngine.Run(":" + *port); err != nil {
			logger.Error("Server stopped: %v", err)
		}
	})

	// Wait for shutdown signal
	sig := <-sigChan
	logger.Info("Received signal %v, initiating graceful shutdown...", sig)

	// Graceful shutdown with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Stop gRPC server
	grpcServer.GracefulStop()
	logger.Info("gRPC server stopped")
	cancelApp()

	<-ctx.Done()
	logger.Info("Shutdown complete")
}

func initializeTelemetry(ctx context.Context) func() {
	provider, err := telemetry.NewFromEnvironment(ctx)
	if err != nil {
		panic(fmt.Sprintf("failed to initialize telemetry: %v", err))
	}
	return func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := provider.Shutdown(shutdownCtx); err != nil {
			logger.Error("failed to shut down telemetry: %v", err)
		}
	}
}

func initializeSandboxAndSeeds(
	ctx context.Context,
	injector *di.Injector,
) error {
	if err := injector.SandboxApp.Start(ctx); err != nil {
		return fmt.Errorf("start sandbox pool: %w", err)
	}
	if err := injector.ScheduledTaskApp.Start(ctx); err != nil {
		return fmt.Errorf("start scheduled task worker: %w", err)
	}
	if shouldRunSeeds() {
		if err := seeds.Run(ctx, injector); err != nil {
			return fmt.Errorf("run seeds: %w", err)
		}
	} else {
		logger.Info("Skipping startup seeds outside development environment")
	}
	return nil
}

func shouldRunSeeds() bool {
	return env.IsDevelopment()
}
