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

package consts

import "time"

const (
	DatabaseHost     = "DB_HOST"
	DatabasePort     = "DB_PORT"
	DatabaseName     = "DB_NAME"
	DatabaseUser     = "DB_USER"
	DatabasePassword = "DB_PASSWORD"
)

const (
	CoreGRPCAddress    = "CORE_GRPC_ADDRESS"
	ReverseGRPCAddress = "REVERSE_GRPC_SERVE_ADDRESS"
	GRPCMaxSendMsgSize = 128 * 1024 * 1024 // 128MB
	GRPCMaxRecvMsgSize = 128 * 1024 * 1024 // 128MB
)

const (
	RedisHost     = "REDIS_HOST"
	RedisPort     = "REDIS_PORT"
	RedisPassword = "REDIS_PASSWORD"

	RedisLockInitialWaitTime = time.Millisecond * 50
	RedisLockMaxWaitTime     = time.Second * 5
)

// Sandbox-related environment variables
const (
	SandboxResetCooldownSeconds = "SANDBOX_RESET_COOLDOWN_SECONDS"
	SandboxEmulatorBaseURL      = "SANDBOX_EMULATOR_BASE_URL"

	SandboxMaxTimestampDrift = "SANDBOX_MAX_TIMESTAMP_DRIFT"
	SandboxNonceExpiry       = "SANDBOX_NONCE_EXPIRY"
)

// Sandbox client auth
const (
	SandboxClientSecretPrefix = "SANDBOX_CLIENT_SECRET_"
)

// Eventbus
const (
	EventBusType  = "EVENT_BUS_TYPE"
	EventBusTopic = "EVENT_BUS_TOPIC"

	KafkaBootstrapServers = "KAFKA_BOOTSTRAP_SERVERS"

	ChatKeepaliveCheckInterval                     = "CHAT_KEEPALIVE_CHECK_INTERVAL"
	ChatKeepaliveCheckIntervalFirstRoundMultiplier = 3
)

// Storage-related environment variables
const (
	SeaweedFSEndpoint = "SEAWEEDFS_ENDPOINT"
	ISO8601Format     = "2006-01-02T15:04:05Z"
)
