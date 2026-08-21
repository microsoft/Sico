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
