package eventbus

import (
	"context"
	"fmt"
	"os"
	"regexp"
	"sico-backend/internal/consts"
	"strings"
	"sync"
	"time"
)

const (
	defaultSubscriptionPrefix = "backend-broadcast"
)

type EventBusMessage struct {
	Payload   []byte
	MessageId string
}

type EventBusSubscription interface {
	Close() error
}

// EventHandler is invoked for each message delivered to a subscription.
type EventHandler = func(ctx context.Context, message *EventBusMessage) error

type EventBus interface {
	Subscribe(
		ctx context.Context,
		topic string,
		subscriptionPrefix string,
		handler EventHandler,
	) (EventBusSubscription, error)
}

var defaultEventBus EventBus
var defaultEventBusInitializationOnce sync.Once

func Default() EventBus {
	if defaultEventBus == nil {
		defaultEventBusInitializationOnce.Do(func() {
			eventBusType := os.Getenv(consts.EventBusType)
			switch eventBusType {
			case "azure_service_bus":
				initialized, err := newAzureServiceBus()
				if err != nil {
					panic(fmt.Sprintf("failed to initialize default event bus: %v", err))
				}
				defaultEventBus = initialized
			case "kafka":
				initialized, err := newKafkaEventBus()
				if err != nil {
					panic(fmt.Sprintf("failed to initialize default event bus: %v", err))
				}
				defaultEventBus = initialized
			default:
				panic("unsupported event bus type: " + eventBusType)
			}
		})
	}
	return defaultEventBus
}

func sanitizeSubscriptionName(input string) string {
	clean := strings.ToLower(strings.TrimSpace(input))
	re := regexp.MustCompile(`[^a-z0-9-]`)
	clean = re.ReplaceAllString(clean, "-")
	clean = strings.Trim(clean, "-")
	if clean == "" {
		return defaultSubscriptionPrefix + "-default"
	}
	// replace all "-" to "_" because Kafka groupId does not allow "-"
	clean = strings.ReplaceAll(clean, "-", "_")
	return clean
}

func buildSubscriptionNameFromEnv(prefix string) string {
	if prefix == "" {
		prefix = defaultSubscriptionPrefix
	}

	replicaID := strings.TrimSpace(os.Getenv("POD_NAME"))
	if replicaID == "" {
		replicaID = strings.TrimSpace(os.Getenv("HOSTNAME"))
	}
	if replicaID == "" {
		replicaID = strings.TrimSpace(os.Getenv("POD_UID"))
	}
	if replicaID == "" {
		replicaID = fmt.Sprintf("local_%d", time.Now().Unix())
	}

	name := sanitizeSubscriptionName(prefix + "_" + replicaID)
	if len(name) > 50 {
		name = name[:50]
	}
	return name
}
