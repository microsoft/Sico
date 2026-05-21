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

package eventbus

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"sico-backend/internal/consts"
	"sico-backend/pkg/logger"
	"sico-backend/pkg/safego"

	"github.com/segmentio/kafka-go"
)

type KafkaEventBus struct {
	bootstrapServers []string
}

type KafkaEventBusSubscription struct {
	topicName   string
	stopChannel chan struct{}
	reader      *kafka.Reader
}

func newKafkaEventBus() (EventBus, error) {
	// get bootstrap servers
	servers := os.Getenv(consts.KafkaBootstrapServers)
	servers = strings.TrimSpace(servers)
	// split by ";"
	bootstrapServersUnfiltered := strings.Split(servers, ";")
	bootstrapServers := make([]string, 0, len(bootstrapServersUnfiltered))
	for i := range bootstrapServersUnfiltered {
		item := strings.TrimSpace(bootstrapServersUnfiltered[i])
		if item == "" {
			continue
		}
		bootstrapServers = append(bootstrapServers, item)
	}
	if len(bootstrapServers) == 0 {
		return nil, fmt.Errorf(
			"no Kafka bootstrap servers provided in environment variable %s",
			consts.KafkaBootstrapServers,
		)
	}
	return &KafkaEventBus{
		bootstrapServers: bootstrapServers,
	}, nil
}

func (k *KafkaEventBus) Subscribe(
	ctx context.Context,
	topic string,
	subscriptionPrefix string,
	handler EventHandler,
) (EventBusSubscription, error) {
	// No need to set groupId because we want each replica to receive
	// message replicates independently.
	// groupId := buildSubscriptionNameFromEnv(subscriptionPrefix)

	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:     k.bootstrapServers,
		Topic:       topic,
		StartOffset: kafka.LastOffset,
	})
	reader.Offset()

	stopChannel := make(chan struct{})
	// create a context that cancels when (1) ctx is canceled,
	// (2) os.Interrupt or syscall.SIGTERM is received, or (3) stopChannel is closed
	loopctx, cancel := context.WithCancel(ctx)
	safego.Go(loopctx, func() {
		sigChannel := make(chan os.Signal, 1)
		signal.Notify(sigChannel, os.Interrupt, syscall.SIGTERM)
		select {
		case <-sigChannel:
			logger.CtxInfo(loopctx, "received shutdown signal")
		case <-stopChannel:
			logger.CtxInfo(loopctx, "stop channel closed, stopping subscription")
		}
		cancel()
	})

	safego.Go(loopctx, func() {
		for {
			m, err := reader.ReadMessage(loopctx)
			if err != nil {
				if err == context.Canceled || err.Error() == "fetching message: context canceled" {
					logger.CtxInfo(loopctx, "context canceled, stopping subscription loop")
					break
				}
				logger.CtxError(loopctx, "error reading message: %v", err)
				continue
			}

			_ = handler(loopctx, &EventBusMessage{
				Payload:   m.Value,
				MessageId: fmt.Sprintf("%d", m.Time.UnixMilli()),
			})
		}

		if err := reader.Close(); err != nil {
			logger.CtxError(context.Background(), "failed to close Kafka reader for subscription: %v", err)
		}
	})

	return &KafkaEventBusSubscription{
		topicName:   topic,
		stopChannel: stopChannel,
		reader:      reader,
	}, nil
}

func (s *KafkaEventBusSubscription) Close() error {
	if s.stopChannel != nil {
		close(s.stopChannel)
	}
	s.stopChannel = nil
	return nil
}
