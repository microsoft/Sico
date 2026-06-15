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

func TestAppliableResourcesForOSOrdersManagedBeforePhysical(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	seedSnapshot(t, ctx, rds, enum.SandboxTypeEmulator.String(), time.Now(), testEmulatorResource(ResourceStatusAvailable))

	svc := &Service{Pool: newTestPool(rds, &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
	}, time.Minute)}

	ordered, byID, _, err := svc.appliableResourcesForOS(ctx, enum.SandboxOSAndroid)
	require.NoError(t, err)

	require.Equal(t, []string{
		enum.SandboxTypeEmulator.String() + ":" + testEmulatorResource(ResourceStatusAvailable).ResourceID,
	}, ordered)
	require.Contains(t, byID, enum.SandboxTypeEmulator.String()+":"+testEmulatorResource(ResourceStatusAvailable).ResourceID)
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

func TestApplySandboxRejectsNonOSSelector(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rds := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rds.Close())
	})

	svc := &Service{Pool: newTestPool(rds, &fakeProvider{
		providerType: enum.SandboxTypeEmulator.String(),
	}, time.Minute)}

	// A concrete sandbox type is no longer accepted by apply.
	_, err := svc.ApplySandbox(ctx, "instance-1", enum.SandboxTypeEmulator.String())
	require.Error(t, err)
}
