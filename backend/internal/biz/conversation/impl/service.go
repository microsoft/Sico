package impl

import (
	"context"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	"sico-backend/internal/biz/agent"
	llmhubsbiz "sico-backend/internal/biz/llmhubs"
	"sico-backend/internal/biz/project"
	"sico-backend/internal/infra/coregrpc"
	"sico-backend/internal/infra/eventbus"
	"sico-backend/internal/infra/idgen"
	"sico-backend/internal/infra/sse"
	"sico-backend/internal/infra/storage"
	conversationRepo "sico-backend/internal/store/conversation/conversation/repository"
	messageRepo "sico-backend/internal/store/conversation/message/repository"
	conversationrpc "sico-backend/internal/transport/grpc/pb/conversation"
	singleagentpb "sico-backend/internal/transport/http/dto/agent/single_agent"
	conversationdto "sico-backend/internal/transport/http/dto/conversation"
	rgrpc "sico-backend/internal/transport/reverse_grpc/pb/conversation"
)

// Components lists dependencies required by the conversation service implementation.
type Components struct {
	ConversationRepo conversationRepo.ConversationRepo
	MessageRepo      messageRepo.MessageRepo
	AgentService     agent.Service
	ProjectService   project.Service
	LLMHubService    llmhubsbiz.Service
	IDGenerator      idgen.IDGenerator
	Storage          storage.Storage
	CoreGRPC         coregrpc.Connection
	Cache            *redis.Client
	DB               *gorm.DB
}

type ChatConnection struct {
	ctx                   context.Context
	sender                sse.SSESender
	notifyDone            chan struct{}
	notifyDoneOnce        sync.Once
	agent                 *singleagentpb.SingleAgent
	agentInstance         *singleagentpb.SingleAgentInstance
	username              string
	turnId                int64
	conversationId        int64
	sentSeq               int64
	bufferedTopicMessages map[int64]*conversationdto.TopicMessage // key is seq
	busyMutex             sync.Mutex
	lastActive            time.Time
}

// signalDone closes notifyDone exactly once so any number of producers
// (eventbus push, gRPC stream error, keepalive timeout, client disconnect)
// can safely signal without attempting to close an already-closed channel.
func (c *ChatConnection) signalDone() {
	c.notifyDoneOnce.Do(func() {
		close(c.notifyDone)
	})
}

func (c *ChatConnection) hasSentTopicMessages() bool {
	c.busyMutex.Lock()
	defer c.busyMutex.Unlock()
	return c.sentSeq > 0
}

type ChatConnectionIdentifier struct {
	ConversationId int64
	TurnId         int64
}

// Service implements the conversation business logic.
type Service struct {
	rgrpc.UnimplementedReverseConversationRPCServer
	conversationRepo     conversationRepo.ConversationRepo
	messageRepo          messageRepo.MessageRepo
	agentSvc             agent.Service
	projectSvc           project.Service
	llmhubSvc            llmhubsbiz.Service
	idGen                idgen.IDGenerator
	storage              storage.Storage
	coreGRPC             coregrpc.Connection
	chatClient           conversationrpc.ChatServiceClient
	chatConnections      map[ChatConnectionIdentifier][]*ChatConnection
	eventBusSubscription eventbus.EventBusSubscription
	cache                *redis.Client
	db                   *gorm.DB
}

// NewService wires dependencies into a conversation service implementation.
func NewService(c *Components) *Service {
	var chatClient conversationrpc.ChatServiceClient
	if c.CoreGRPC != nil {
		chatClient = conversationrpc.NewChatServiceClient(c.CoreGRPC)
	}

	svc := &Service{
		conversationRepo: c.ConversationRepo,
		messageRepo:      c.MessageRepo,
		agentSvc:         c.AgentService,
		projectSvc:       c.ProjectService,
		llmhubSvc:        c.LLMHubService,
		idGen:            c.IDGenerator,
		storage:          c.Storage,
		coreGRPC:         c.CoreGRPC,
		chatClient:       chatClient,
		chatConnections:  make(map[ChatConnectionIdentifier][]*ChatConnection),
		cache:            c.Cache,
		db:               c.DB,
	}

	_ = svc.SubscribeTopic()

	return svc
}
