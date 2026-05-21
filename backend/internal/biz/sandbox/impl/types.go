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
