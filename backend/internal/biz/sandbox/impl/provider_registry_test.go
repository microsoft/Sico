package impl

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"

	"sico-backend/internal/shared/enum"
)

func TestProviderRegistryPreservesRegistrationOrder(t *testing.T) {
	registry, err := NewProviderRegistry(nil)
	require.NoError(t, err)
	managed := &fakeProvider{providerType: "managed"}
	physical := &fakeProvider{providerType: "physical"}

	require.NoError(t, registry.Register(managed))
	require.NoError(t, registry.Register(physical))
	require.Equal(t, []Provider{managed, physical}, registry.Providers())
}

func TestProviderRegistryRejectsDuplicateTypes(t *testing.T) {
	registry, err := NewProviderRegistry(nil)
	require.NoError(t, err)
	require.NoError(t, registry.Register(&fakeProvider{providerType: "emulator"}))

	err = registry.Register(&fakeProvider{providerType: "emulator"})
	require.EqualError(t, err, `sandbox provider type "emulator" is already registered`)
}

func TestProviderRegistryRejectsRegistrationAfterSeal(t *testing.T) {
	registry, err := NewProviderRegistry(nil)
	require.NoError(t, err)
	registry.Seal()

	err = registry.Register(&fakeProvider{providerType: "emulator"})
	require.EqualError(t, err, "sandbox provider registry is sealed")
}

func TestPoolStartSealsProviderRegistry(t *testing.T) {
	registry, err := NewProviderRegistry(nil)
	require.NoError(t, err)
	pool := NewPool(registry, nil)
	pool.refreshInterval = 0

	require.NoError(t, pool.Start(context.Background()))
	err = registry.Register(&fakeProvider{providerType: "emulator"})
	require.EqualError(t, err, "sandbox provider registry is sealed")
}

func TestPoolStartRefreshesProviderSnapshotBeforeReturning(t *testing.T) {
	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	provider := &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		responses: [][]*Resource{
			{testEmulatorResource(ResourceStatusAvailable)},
		},
	}
	registry, err := NewProviderRegistry(nil)
	require.NoError(t, err)
	require.NoError(t, registry.Register(provider))
	pool := NewPool(registry, rds)
	pool.refreshInterval = 0
	pool.refreshLeaderTTL = time.Second

	require.NoError(t, pool.Start(ctx))
	snapshot := loadSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String())
	require.Len(t, snapshot.Resources, 1)
	require.Equal(t, testEmulatorResource(ResourceStatusAvailable).ResourceID, snapshot.Resources[0].ResourceID)
	require.Equal(t, 1, provider.calls)
}

func TestProviderRegistryRegistersFactoryProviders(t *testing.T) {
	managed := &fakeProvider{providerType: "managed"}
	physical := &fakeProvider{providerType: "physical"}

	registry, err := NewProviderRegistry([]Provider{managed, physical})
	require.NoError(t, err)
	require.Equal(t, []Provider{managed, physical}, registry.Providers())
}
