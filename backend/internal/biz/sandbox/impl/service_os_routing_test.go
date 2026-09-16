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

func TestResolveSandboxOS(t *testing.T) {
	// An OS selector parses to its capability.
	os, err := resolveSandboxOS("android")
	require.NoError(t, err)
	require.Equal(t, enum.SandboxOSAndroid, os)

	// A concrete sandbox type is no longer a valid scheduling selector.
	_, err = resolveSandboxOS(enum.SandboxTypeEmulator.String())
	require.Error(t, err)

	// A typo fails fast.
	_, err = resolveSandboxOS("bogus")
	require.Error(t, err)
}

func TestLeaseMatchesOS(t *testing.T) {
	// A fixed-OS type resolves by its type, regardless of metadata.
	require.True(t, leaseMatchesOS(&Lease{Type: enum.SandboxTypeEmulator.String()}, enum.SandboxOSAndroid))

	// An unknown type never matches.
	require.False(t, leaseMatchesOS(&Lease{Type: "bogus"}, enum.SandboxOSAndroid))

	// Nil lease never matches.
	require.False(t, leaseMatchesOS(nil, enum.SandboxOSAndroid))
}

func TestLeaseMatchesLinuxWorkstationSelector(t *testing.T) {
	lease := &Lease{Type: enum.SandboxTypeLinuxWorkstation.String()}

	require.True(t, leaseMatchesSelector(lease, enum.SandboxTypeLinuxWorkstation.String(), "", false))
}

func TestAppliableResourcesForOSOrdersManagedBeforePhysical(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	emulator := testEmulatorResource(ResourceStatusAvailable)
	physical := &Resource{
		Type: enum.SandboxTypePhysical.String(), ResourceID: "manager|device-1", Status: ResourceStatusAvailable,
		Metadata: map[string]string{enum.MetadataOSKey: enum.SandboxOSAndroid.String()},
	}
	seedSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String(), time.Now(), emulator)
	seedSnapshot(t, ctx, rds, enum.SandboxTypePhysical.String(), time.Now(), physical)

	svc := &Service{Pool: newTestPoolWithProviders(
		rds,
		time.Minute,
		&fakeProvider{providerType: enum.SandboxTypeEmulator.String()},
		&fakeProvider{providerType: enum.SandboxTypePhysical.String()},
	)}

	ordered, byID, _, err := svc.appliableResourcesForOS(ctx, enum.SandboxOSAndroid)
	require.NoError(t, err)

	require.Equal(t, []string{
		enum.SandboxTypeEmulator.String() + ":" + emulator.ResourceID,
		enum.SandboxTypePhysical.String() + ":" + physical.ResourceID,
	}, ordered)
	require.Contains(t, byID, enum.SandboxTypeEmulator.String()+":"+emulator.ResourceID)
	require.Contains(t, byID, enum.SandboxTypePhysical.String()+":"+physical.ResourceID)
}

func TestAppliableResourcesForOSReturnsEmptyWhenNoProviderSuppliesOS(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { require.NoError(t, rds.Close()) })
	seedSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String(), time.Now(), testEmulatorResource(ResourceStatusAvailable))

	svc := &Service{Pool: newTestPool(rds, &fakeProvider{providerType: enum.SandboxTypeEmulator.String()}, time.Minute)}
	ordered, byID, _, err := svc.appliableResourcesForOS(ctx, enum.SandboxOSWindows)

	require.NoError(t, err)
	require.Empty(t, ordered)
	require.Empty(t, byID)
}

func TestApplySandboxReturnsNilWhenNoResourceSuppliesOS(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	// The emulator pool is enabled but its snapshot is empty.
	seedSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String(), time.Now())
	svc := &Service{Pool: newTestPool(rds, &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
	}, time.Minute)}

	result, err := svc.ApplySandbox(ctx, "instance-1", enum.SandboxOSAndroid.String())
	require.NoError(t, err)
	require.Nil(t, result)
}

func TestApplySandboxAcceptsConcreteLinuxWorkstationSelector(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	linuxWorkstation := &Resource{
		Type:       enum.SandboxTypeLinuxWorkstation.String(),
		ResourceID: "linux-workstation-1", Status: ResourceStatusAvailable,
	}
	seedSnapshot(t, ctx, rds, enum.SandboxTypeLinuxWorkstation.String(), time.Now(), linuxWorkstation)
	lease := &Lease{
		SandboxID:  enum.SandboxTypeLinuxWorkstation.String() + ":" + linuxWorkstation.ResourceID,
		Type:       enum.SandboxTypeLinuxWorkstation.String(),
		ResourceID: linuxWorkstation.ResourceID,
		User:       "instance-1",
	}
	seedLease(t, ctx, rds, lease)
	svc := &Service{Pool: newTestPool(rds, &fakeProvider{
		providerType: enum.SandboxTypeLinuxWorkstation.String(),
	}, time.Minute)}

	result, err := svc.ApplySandbox(ctx, "instance-1", enum.SandboxTypeLinuxWorkstation.String())

	require.NoError(t, err)
	require.Equal(t, lease.SandboxID, result["sandbox_id"])
}

func TestApplySandboxRejectsOtherConcreteSelectors(t *testing.T) {
	svc := &Service{}

	_, err := svc.ApplySandbox(context.Background(), "instance-1", enum.SandboxTypeEmulator.String())

	require.Error(t, err)
}
