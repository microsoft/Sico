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
		Type:       lease.Type,
	})
	require.NoError(t, err)
	require.Equal(t, int32(0), resp.GetCode())
	require.True(t, resp.GetApplied())
	require.Equal(t, "/api/sico/sandbox/resources/emulator/"+hashResourceID(lease.ResourceID)+"/vnc", resp.GetVncUrl())
}
