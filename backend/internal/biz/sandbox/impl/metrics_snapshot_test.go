package impl

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
)

func TestMetricsSnapshotAppliesLeaseOverlayAndProviderHealth(t *testing.T) {
	ctx := context.Background()
	memoryRedis := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: memoryRedis.Addr()})
	t.Cleanup(func() { require.NoError(t, rds.Close()) })

	resource := testEmulatorResource(ResourceStatusAvailable)
	provider := &fakeProvider{providerType: resource.Type}
	pool := newTestPool(rds, provider, time.Minute)
	seedSnapshot(t, ctx, rds, resource.Type, time.Now(), resource)
	seedLease(t, ctx, rds, testEmulatorLease())
	pool.providerLastSuccessAt[resource.Type] = time.Now()

	snapshot, err := pool.MetricsSnapshot(ctx)
	require.NoError(t, err)
	require.Equal(t, int64(1), snapshot.ResourcesByTypeStatus[resource.Type][string(ResourceStatusAssigned)])
	require.Equal(t, int64(1), snapshot.ProviderHealthy[resource.Type])

	pool.providerFailureCount[resource.Type] = 1
	snapshot, err = pool.MetricsSnapshot(ctx)
	require.NoError(t, err)
	require.Equal(t, int64(0), snapshot.ProviderHealthy[resource.Type])

	pool.refreshMu.Lock()
	_, err = pool.MetricsSnapshot(ctx)
	pool.refreshMu.Unlock()
	require.ErrorIs(t, err, errSnapshotRefreshInProgress)
}
