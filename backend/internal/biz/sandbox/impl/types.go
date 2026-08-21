package impl

import "time"

type ResourceStatus string

const (
	ResourceStatusUnknown     ResourceStatus = "unknown"
	ResourceStatusAvailable   ResourceStatus = "available"
	ResourceStatusAssigned    ResourceStatus = "assigned" // assigned to instance but not actively in use
	ResourceStatusInUse       ResourceStatus = "in_use"   // assigned and actively being used (after apply)
	ResourceStatusUnhealthy   ResourceStatus = "unhealthy"
	ResourceStatusUnavailable ResourceStatus = "unavailable"
)

type Resource struct {
	Type           string            `json:"type"`
	ResourceID     string            `json:"resourceID"`
	DisplayName    string            `json:"displayName,omitempty"`
	Status         ResourceStatus    `json:"status"`
	Metadata       map[string]string `json:"metadata,omitempty"`
	LastSeenAt     *time.Time        `json:"lastSeenAt,omitempty"`
	MissingSinceAt *time.Time        `json:"missingSinceAt,omitempty"`
}

type ResourceSnapshot struct {
	Type        string      `json:"type"`
	RefreshedAt time.Time   `json:"refreshedAt"`
	Resources   []*Resource `json:"resources"`
}

type Lease struct {
	SandboxID              string // format: {type}:{resourceID}
	Type                   string
	ResourceID             string
	User                   string
	InUse                  bool // true when actively used by an apply, false after release
	CreatedAt              time.Time
	Metadata               map[string]string // Resource metadata (e.g., adbAddress for emulator)
	ProviderMissingSinceAt *time.Time        `json:"ProviderMissingSinceAt,omitempty"`
}
