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
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestResourceStatus_Constants(t *testing.T) {
	// Verify string values are stable (used in Redis keys and API responses)
	assert.Equal(t, ResourceStatus("available"), ResourceStatusAvailable)
	assert.Equal(t, ResourceStatus("assigned"), ResourceStatusAssigned)
	assert.Equal(t, ResourceStatus("in_use"), ResourceStatusInUse)
	assert.Equal(t, ResourceStatus("unhealthy"), ResourceStatusUnhealthy)
	assert.Equal(t, ResourceStatus("unavailable"), ResourceStatusUnavailable)
	assert.Equal(t, ResourceStatus("unknown"), ResourceStatusUnknown)
}

func TestResource_Fields(t *testing.T) {
	now := time.Now()
	r := Resource{
		Type:       "emulator",
		ResourceID: "emu-1",
		Status:     ResourceStatusAvailable,
		Metadata:   map[string]string{"adbAddress": "127.0.0.1:5554"},
		LastSeenAt: &now,
	}

	assert.Equal(t, "emulator", r.Type)
	assert.Equal(t, "emu-1", r.ResourceID)
	assert.Equal(t, ResourceStatusAvailable, r.Status)
	assert.Equal(t, "127.0.0.1:5554", r.Metadata["adbAddress"])
	assert.NotNil(t, r.LastSeenAt)
	assert.Nil(t, r.MissingSinceAt)
}

func TestLease_Fields(t *testing.T) {
	lease := Lease{
		SandboxID:  "emulator:emu-1",
		Type:       "emulator",
		ResourceID: "emu-1",
		User:       "instance-42",
		InUse:      true,
		CreatedAt:  time.Now(),
		Metadata:   map[string]string{"port": "5554"},
	}

	assert.Equal(t, "emulator:emu-1", lease.SandboxID)
	assert.True(t, lease.InUse)
	assert.Nil(t, lease.ProviderMissingSinceAt)
}

func TestResourceSnapshot_Fields(t *testing.T) {
	now := time.Now()
	snap := ResourceSnapshot{
		Type:        "emulator",
		RefreshedAt: now,
		Resources: []*Resource{
			{ResourceID: "emu-1", Status: ResourceStatusAvailable},
			{ResourceID: "emu-2", Status: ResourceStatusInUse},
		},
	}

	assert.Equal(t, "emulator", snap.Type)
	assert.Len(t, snap.Resources, 2)
	assert.Equal(t, "emu-1", snap.Resources[0].ResourceID)
}
