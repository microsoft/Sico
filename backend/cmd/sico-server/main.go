// Copyright (c) 2026 Sico Authors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

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
	"google.golang.org/grpc"

	"sico-backend/api/openapi"
	"sico-backend/cmd/sico-server/seeds"
	"sico-backend/internal/consts"
	"sico-backend/internal/di"
	"sico-backend/internal/infra/migration"
	"sico-backend/internal/transport/reverse_grpc"
	"sico-backend/internal/transport/router"
	"sico-backend/pkg/env"
	"sico-backend/pkg/logger"
	"sico-backend/pkg/safego"
)

func main() {
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

	injector, cleanup, err := di.BuildInjector(context.Background())
	if err != nil {
		panic(fmt.Sprintf("failed to build injector: %v", err))
	}
	if cleanup != nil {
		defer cleanup()
	}

	err = seeds.Run(context.Background(), injector)
	if err != nil {
		panic(fmt.Sprintf("failed to run seeds: %v", err))
	}

	port := flag.String("port", "8081", "Port to run the server on")
	flag.Parse()

	address := os.Getenv(consts.ReverseGRPCAddress)
	listener, err := net.Listen("tcp", address)
	if err != nil {
		panic(fmt.Sprintf("failed to listen on %s: %v", address, err))
	}

	grpcServer := grpc.NewServer(
		// increase max receive message size
		grpc.MaxRecvMsgSize(consts.GRPCMaxRecvMsgSize),
		grpc.MaxSendMsgSize(consts.GRPCMaxSendMsgSize),
	)
	reverse_grpc.RegisterReverseGRPCServer(grpcServer)

	safego.Go(context.Background(), func() {
		logger.Info("Starting reverse gRPC server on %s", address)
		if err := grpcServer.Serve(listener); err != nil {
			logger.Error("Reverse gRPC server stopped: %v", err)
		}
	})

	router.RegisterAPIs(ginEngine)

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

	<-ctx.Done()
	logger.Info("Shutdown complete")
}
