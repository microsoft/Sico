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

package impl

import (
	"context"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	"sico-backend/internal/biz/agent"
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
