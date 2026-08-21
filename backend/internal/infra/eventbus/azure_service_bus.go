package eventbus

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore"
	"github.com/Azure/azure-sdk-for-go/sdk/azidentity"
	"github.com/Azure/azure-sdk-for-go/sdk/messaging/azservicebus"
	servicebusadmin "github.com/Azure/azure-sdk-for-go/sdk/messaging/azservicebus/admin"

	"sico-backend/internal/consts"
	"sico-backend/pkg/logger"
	"sico-backend/pkg/safego"
)

const (
	azureServiceBusReceiveBatchSize = 1
	azureServiceBusSessionID        = "default-session"
)

type AzureServiceBus struct {
	client      *azservicebus.Client
	adminClient *servicebusadmin.Client
}

type AzureServiceBusSubscription struct {
	stopChannel     chan struct{}
	sessionReceiver *azservicebus.SessionReceiver
}

func newAzureServiceBus() (EventBus, error) {
	namespace := strings.TrimSpace(os.Getenv(consts.AzureServiceBusNamespace))
	if namespace == "" {
		return nil, fmt.Errorf("azure service bus namespace is not set")
	}
	credential, err := azidentity.NewDefaultAzureCredential(nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create Azure credential: %w", err)
	}
	client, err := azservicebus.NewClient(namespace, credential, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create Azure Service Bus client: %w", err)
	}
	adminClient, err := servicebusadmin.NewClient(namespace, credential, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create Azure Service Bus admin client: %w", err)
	}
	return &AzureServiceBus{client: client, adminClient: adminClient}, nil
}

func isAzureNotFound(err error) bool {
	var responseError *azcore.ResponseError
	return errors.As(err, &responseError) && responseError.StatusCode == 404
}

func isAzureConflict(err error) bool {
	var responseError *azcore.ResponseError
	return errors.As(err, &responseError) && responseError.StatusCode == 409
}

func (s *AzureServiceBus) ensureSubscription(ctx context.Context, topic, subscription string) error {
	response, err := s.adminClient.GetSubscription(ctx, topic, subscription, nil)
	if response != nil && err == nil {
		if response.RequiresSession == nil || !*response.RequiresSession {
			logger.CtxWarn(
				ctx,
				"subscription %s exists with sessions disabled; recreating with RequiresSession=true",
				subscription,
			)
			_, deleteErr := s.adminClient.DeleteSubscription(ctx, topic, subscription, nil)
			if deleteErr != nil && !isAzureNotFound(deleteErr) {
				return fmt.Errorf("delete non-session subscription %s: %w", subscription, deleteErr)
			}
		} else {
			return nil
		}
	}
	if err != nil && !isAzureNotFound(err) {
		return fmt.Errorf("check subscription %s existence: %w", subscription, err)
	}
	requireSession := true
	properties := &servicebusadmin.SubscriptionProperties{RequiresSession: &requireSession}
	if autoDeleteOnIdle := os.Getenv(consts.AzureServiceBusAutoDeleteOnIdle); autoDeleteOnIdle != "" {
		properties.AutoDeleteOnIdle = &autoDeleteOnIdle
	}
	_, err = s.adminClient.CreateSubscription(ctx, topic, subscription, &servicebusadmin.CreateSubscriptionOptions{
		Properties: properties,
	})
	if err != nil && !isAzureConflict(err) {
		return fmt.Errorf("create subscription %s: %w", subscription, err)
	}
	return nil
}

func (s *AzureServiceBus) Subscribe(
	ctx context.Context,
	topic string,
	subscriptionPrefix string,
	handler EventHandler,
) (EventBusSubscription, error) {
	subscription := buildSubscriptionNameFromEnv(subscriptionPrefix)
	if err := s.ensureSubscription(ctx, topic, subscription); err != nil {
		return nil, fmt.Errorf("ensure subscription: %w", err)
	}
	sessionReceiver, err := s.client.AcceptSessionForSubscription(
		ctx,
		topic,
		subscription,
		azureServiceBusSessionID,
		&azservicebus.SessionReceiverOptions{ReceiveMode: azservicebus.ReceiveModeReceiveAndDelete},
	)
	if err != nil {
		return nil, fmt.Errorf("accept next session for %s/%s: %w", topic, subscription, err)
	}
	stopChannel := make(chan struct{})
	loopContext, cancel := context.WithCancel(context.Background())
	safego.Go(loopContext, func() {
		signalChannel := make(chan os.Signal, 1)
		signal.Notify(signalChannel, os.Interrupt, syscall.SIGTERM)
		select {
		case <-signalChannel:
		case <-stopChannel:
		}
		cancel()
	})
	safego.Go(loopContext, func() {
		s.subscriptionReceiveLoop(loopContext, sessionReceiver, handler)
		s.cleanupSubscription(sessionReceiver, topic, subscription)
	})
	return &AzureServiceBusSubscription{stopChannel: stopChannel, sessionReceiver: sessionReceiver}, nil
}

func (s *AzureServiceBus) subscriptionReceiveLoop(
	ctx context.Context,
	sessionReceiver *azservicebus.SessionReceiver,
	handler EventHandler,
) {
	for {
		messages, err := sessionReceiver.ReceiveMessages(ctx, azureServiceBusReceiveBatchSize, nil)
		if err != nil {
			if !errors.Is(err, context.Canceled) {
				logger.CtxWarn(ctx, "session receive ended for session %s: %v", sessionReceiver.SessionID(), err)
			}
			return
		}
		for _, azureMessage := range messages {
			message := &EventBusMessage{Payload: azureMessage.Body, MessageId: azureMessage.MessageID}
			if err := handler(ctx, message); err != nil {
				logger.CtxError(ctx, "failed to handle message id=%s: %v", message.MessageId, err)
			}
		}
	}
}

func (s *AzureServiceBus) cleanupSubscription(
	sessionReceiver *azservicebus.SessionReceiver,
	topic, subscription string,
) {
	ctx := context.Background()
	if err := sessionReceiver.Close(ctx); err != nil {
		logger.CtxError(ctx, "failed to close session receiver for subscription %s: %v", subscription, err)
	}
	if _, err := s.adminClient.DeleteSubscription(ctx, topic, subscription, nil); err != nil && !isAzureNotFound(err) {
		logger.CtxError(ctx, "failed to delete subscription %s: %v", subscription, err)
	}
}

func (s *AzureServiceBusSubscription) Close() error {
	if s.stopChannel != nil {
		close(s.stopChannel)
		s.stopChannel = nil
	}
	return nil
}
