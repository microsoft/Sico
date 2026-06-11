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
	"fmt"
	"time"

	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/enum"
	"sico-backend/internal/shared/errcode"
)

// resolveSandboxOS parses a scheduling selector into the OS capability it names.
//
// Scheduling (apply / acquire / instance listing) speaks OS only: a task asks
// for an OS (e.g. "android") and the scheduler matches whatever concrete sandbox
// can supply it. Concrete sandbox types stay an internal detail of providers,
// snapshots, leases and resource-proxy paths — never a scheduling input. An
// unrecognized selector is an invalid-param error so a typo fails fast.
func resolveSandboxOS(selector string) (enum.SandboxOS, error) {
	if os, ok := enum.ParseSandboxOS(selector); ok {
		return os, nil
	}

	return "", apperr.New(errcode.CommonInvalidParam, "invalid sandbox os: "+selector)
}

// leaseMatchesOS reports whether a lease supplies the given OS. A lease's OS is
// resolved from its concrete type (fixed-OS types) or, for physical devices,
// from its metadata["os"] — see enum.ResolveResourceOS.
func leaseMatchesOS(lease *Lease, os enum.SandboxOS) bool {
	if lease == nil {
		return false
	}

	resolved, ok := enum.ResolveResourceOS(lease.Type, lease.Metadata)
	return ok && resolved == os
}

// appliableResourcesForOS collects the currently-available resources that can
// supply os, across every enabled provider, and returns them as:
//   - ordered: candidate sandboxIDs ("{type}:{resourceID}") in scheduling
//     priority order (fixed-OS types first, then physical) so apply prefers a
//     disposable managed pool over a person's real machine;
//   - byID: the same resources keyed by sandboxID, for metadata merging.
//
// The OS filter is the single source of selection: a fixed-OS type matches by
// its type, a physical device by its metadata["os"]. Providers disabled in this
// deployment have no snapshot and contribute nothing — no special casing needed.
func (s *Service) appliableResourcesForOS(
	ctx context.Context, os enum.SandboxOS,
) ([]string, map[string]*Resource, time.Duration, error) {
	resources, age, ok, err := s.Pool.loadSnapshotResources(ctx, "")
	if err != nil {
		return nil, nil, age, apperr.New(errcode.SandboxProviderUnavailable,
			fmt.Sprintf("failed to load sandbox resources: %v", err))
	}
	if !ok {
		return nil, nil, age, apperr.New(errcode.SandboxProviderUnavailable,
			"sandbox resource snapshot unavailable")
	}

	byID := make(map[string]*Resource, len(resources))
	byType := make(map[string][]string)
	for _, resource := range resources {
		if resource == nil || resource.ResourceID == "" {
			continue
		}
		if resource.Status != ResourceStatusAvailable {
			continue
		}
		resolved, matched := enum.ResolveResourceOS(resource.Type, resource.Metadata)
		if !matched || resolved != os {
			continue
		}
		sandboxID := resource.Type + ":" + resource.ResourceID
		byID[sandboxID] = resource
		byType[resource.Type] = append(byType[resource.Type], sandboxID)
	}

	var ordered []string
	for _, t := range enum.EligibleTypesForOS(os) {
		ordered = append(ordered, byType[t]...)
	}

	return ordered, byID, age, nil
}
