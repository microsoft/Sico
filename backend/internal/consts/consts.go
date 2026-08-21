package consts

import "time"

const (
	DatabaseDSN      = "MYSQL_DSN"
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
	MailEndpoint      = "MAIL_ENDPOINT"
	MailAccessKey     = "MAIL_ACCESS_KEY"
	MailSenderAddress = "MAIL_SENDER_ADDRESS"
)

const (
	RedisHost     = "REDIS_HOST"
	RedisPort     = "REDIS_PORT"
	RedisPassword = "REDIS_PASSWORD"
	RedisAuthType = "REDIS_AUTH_TYPE"

	RedisLockInitialWaitTime = time.Millisecond * 50
	RedisLockMaxWaitTime     = time.Second * 5
)

// Sandbox-related environment variables
const (
	SandboxResetCooldownSeconds = "SANDBOX_RESET_COOLDOWN_SECONDS"
	SandboxEmulatorBaseURL      = "SANDBOX_EMULATOR_BASE_URL"
	SandboxRedisNamespace       = "SANDBOX_REDIS_NAMESPACE"

	SandboxMaxTimestampDrift = "SANDBOX_MAX_TIMESTAMP_DRIFT"
	SandboxNonceExpiry       = "SANDBOX_NONCE_EXPIRY"
)

// Sandbox client auth
const (
	SandboxClientSecretPrefix = "SANDBOX_CLIENT_SECRET_"
)

// Eventbus
const (
	EventBusType                    = "EVENT_BUS_TYPE"
	EventBusTopic                   = "EVENT_BUS_TOPIC"
	AzureServiceBusNamespace        = "AZURE_SERVICE_BUS_NAMESPACE"
	AzureServiceBusAutoDeleteOnIdle = "AZURE_SERVICE_BUS_AUTO_DELETE_ON_IDLE"

	KafkaBootstrapServers = "KAFKA_BOOTSTRAP_SERVERS"

	ChatKeepaliveCheckInterval                     = "CHAT_KEEPALIVE_CHECK_INTERVAL"
	ChatKeepaliveCheckIntervalFirstRoundMultiplier = 3
)

// Storage-related environment variables
const (
	StorageType          = "STORAGE_TYPE"
	SeaweedFSEndpoint    = "SEAWEEDFS_ENDPOINT"
	AzureBlobEndpoint    = "AZURE_BLOB_ENDPOINT"
	AzureBlobContainer   = "AZURE_BLOB_CONTAINER"
	AzureBlobCDNEndpoint = "AZURE_BLOB_CDN_ENDPOINT"
	ISO8601Format        = "2006-01-02T15:04:05Z"
)
