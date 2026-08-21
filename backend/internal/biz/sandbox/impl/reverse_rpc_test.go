package impl

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"

	"sico-backend/internal/shared/enum"
	sandboxRgrpc "sico-backend/internal/transport/reverse_grpc/pb/sandbox"
)

func TestRpcApplySandboxReturnsVNCURL(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	lease := testEmulatorLease()
	seedLease(t, ctx, rds, lease)
	seedSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String(), time.Now(), testEmulatorResource(ResourceStatusAvailable))

	svc := &Service{Pool: newTestPool(rds, &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
		errs:         []error{context.Canceled},
	}, time.Minute)}

	resp, err := svc.RpcApplySandbox(ctx, &sandboxRgrpc.ApplySandboxRequest{
		InstanceId: lease.User,
		Type:       osForLease(lease),
	})
	require.NoError(t, err)
	require.Equal(t, int32(0), resp.GetCode())
	require.True(t, resp.GetApplied())
	require.Equal(t, "/api/sico/sandbox/resources/emulator/"+hashResourceID(lease.ResourceID)+"/vnc", resp.GetVncUrl())
	require.Equal(t, enum.SandboxOSAndroid.String(), resp.GetOs())
	require.Equal(t, enum.SandboxTypeEmulator.String(), resp.GetProviderType())
}
