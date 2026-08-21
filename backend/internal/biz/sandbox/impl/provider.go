package impl

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
)

type Provider interface {
	Type() string
	ListResources(ctx context.Context) ([]*Resource, error)
	ResetResource(ctx context.Context, resourceID string) error
}

type ProviderEndpoints struct {
	Endpoint   string
	VNCURL     string
	VNCOpenURL string
}

type EndpointRenderer interface {
	RenderEndpoints(resourceID string, metadata map[string]string) ProviderEndpoints
}

type OpenAPIResolver interface {
	OpenAPIURL(resourceID string, metadata map[string]string) string
}

type DisplayNameProvider interface {
	DisplayNamePrefix() string
}

type ProviderRegistry struct {
	mu        sync.RWMutex
	providers []Provider
	byType    map[string]Provider
	sealed    bool
}

func NewProviderRegistry(providers []Provider) (*ProviderRegistry, error) {
	registry := &ProviderRegistry{byType: make(map[string]Provider)}
	for _, provider := range providers {
		if err := registry.Register(provider); err != nil {
			return nil, err
		}
	}
	return registry, nil
}

func (r *ProviderRegistry) Register(provider Provider) error {
	if r == nil {
		return errors.New("sandbox provider registry is nil")
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if r.sealed {
		return errors.New("sandbox provider registry is sealed")
	}
	if provider == nil {
		return errors.New("sandbox provider is nil")
	}

	providerType := strings.TrimSpace(provider.Type())
	if providerType == "" {
		return errors.New("sandbox provider type is empty")
	}
	if _, exists := r.byType[providerType]; exists {
		return fmt.Errorf("sandbox provider type %q is already registered", providerType)
	}

	r.providers = append(r.providers, provider)
	r.byType[providerType] = provider
	return nil
}

func (r *ProviderRegistry) Seal() {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sealed = true
}

func (r *ProviderRegistry) Providers() []Provider {
	if r == nil {
		return nil
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	return append([]Provider(nil), r.providers...)
}
