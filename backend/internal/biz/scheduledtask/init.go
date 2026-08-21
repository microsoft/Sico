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

package scheduledtask

import (
	"github.com/google/wire"

	"sico-backend/internal/biz/conversation"
	"sico-backend/internal/biz/notification"
	"sico-backend/internal/biz/scheduledtask/impl"
	"sico-backend/internal/infra/cron"
	emailinfra "sico-backend/internal/infra/email"
	"sico-backend/internal/infra/storage"
	rbacrepository "sico-backend/internal/store/rbac/repository"
	"sico-backend/internal/store/scheduledtask/repository"
)

var defaultSvc Service

func Default() Service { return defaultSvc }

func InitService(components *impl.Components) Service {
	defaultSvc = impl.NewService(components)
	return defaultSvc
}

func ProvideConversationService(service conversation.Service) impl.ConversationService {
	return service
}

func ProvideNotificationService(service notification.Service) impl.NotificationService {
	return service
}

func ProvideEmailClient(client emailinfra.Client) impl.EmailClient { return client }

func ProvideUserRepository(repository rbacrepository.UserRepository) impl.UserRepository {
	return repository
}

func ProvideDeliverableStorage(storageService storage.Storage) impl.DeliverableStorage {
	return storageService
}

var ProviderSet = wire.NewSet(
	repository.NewRepository,
	cron.NewParser,
	ProvideConversationService,
	ProvideNotificationService,
	ProvideEmailClient,
	ProvideUserRepository,
	ProvideDeliverableStorage,
	wire.Struct(new(impl.Components), "*"),
	InitService,
)
