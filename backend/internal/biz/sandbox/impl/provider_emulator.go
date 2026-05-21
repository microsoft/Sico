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
	"strconv"
	"strings"
	"time"

	"sico-backend/internal/consts"
	"sico-backend/internal/shared/enum"
	"sico-backend/pkg/env"
)

type EmulatorProvider struct {
	BaseURLs []string
	http     *httpClient
}

func NewEmulatorProvider() *EmulatorProvider {
	raw := env.GetOrDefault(consts.SandboxEmulatorBaseURL, "")
	parts := splitAndTrim(raw)
	for i := range parts {
		parts[i] = strings.TrimRight(parts[i], "/")
	}
	return &EmulatorProvider{
		BaseURLs: parts,
		http:     newHTTPClient(8 * time.Second),
	}
}

func splitAndTrim(s string) []string {
	parts := strings.Split(s, ",")
	var out []string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func (p *EmulatorProvider) Type() string { return enum.SandboxTypeEmulator.String() }

func (p *EmulatorProvider) enabled() bool { return p != nil && len(p.BaseURLs) > 0 }

type emulatorDevicesResp struct {
	Devices []struct {
		DeviceIndex int    `json:"device_index"`
		AdbHost     string `json:"adb_host"`
		AdbPort     int    `json:"adb_port"`
		ViewURL     string `json:"view_url"`
	} `json:"devices"`
}

func (p *EmulatorProvider) ListResources(ctx context.Context) ([]*Resource, error) {
	if !p.enabled() {
		return []*Resource{}, nil
	}

	out := make([]*Resource, 0)
	attempted := 0
	succeeded := 0
	var firstErr error
	for _, baseURL := range p.BaseURLs {
		if baseURL == "" {
			continue
		}
		attempted++

		// Get devices from VNC endpoint (includes ADB info)
		var resp emulatorDevicesResp
		if err := p.http.getJSON(ctx, baseURL+"/vnc/devices", &resp); err != nil {
			if firstErr == nil {
				firstErr = err
			}
			// If one provider is down, continue with the rest.
			continue
		}
		succeeded++

		for _, d := range resp.Devices {
			deviceID := strconv.Itoa(d.DeviceIndex)
			resourceID := formatEmulatorResourceID(baseURL, deviceID)

			metadata := map[string]string{
				"providerBaseUrl": baseURL,
				"deviceId":        deviceID,
			}

			// Include ADB connection info if available
			if d.AdbHost != "" && d.AdbPort > 0 {
				metadata["adbHost"] = d.AdbHost
				metadata["adbPort"] = strconv.Itoa(d.AdbPort)
				metadata["adbAddress"] = fmt.Sprintf("%s:%d", d.AdbHost, d.AdbPort)
			}

			out = append(out, &Resource{
				Type:        p.Type(),
				ResourceID:  resourceID,
				DisplayName: fmt.Sprintf("Android Device #%d", d.DeviceIndex),
				Status:      ResourceStatusAvailable,
				Metadata:    metadata,
			})
		}
	}

	if attempted > 0 && succeeded == 0 && firstErr != nil {
		return nil, fmt.Errorf("failed to list emulator resources from all configured endpoints: %w", firstErr)
	}

	return out, nil
}

func (p *EmulatorProvider) ResetResource(ctx context.Context, resourceID string) error {
	if !p.enabled() {
		return fmt.Errorf("emulator provider not configured")
	}

	baseURL, deviceID, err := p.parseEmulatorResourceID(resourceID)
	if err != nil {
		return fmt.Errorf("invalid emulator resource id: %w", err)
	}

	idx, err := strconv.Atoi(deviceID)
	if err != nil {
		return fmt.Errorf("invalid emulator device index: %w", err)
	}

	// Use soft-reset: close all user apps and go to home screen.
	// Unlike a full restart, this preserves the ADB port so existing
	// port-forward rules remain valid — no more stale-port issues.
	softResetURL := fmt.Sprintf("%s/api/v1/emulators/%d/soft-reset", baseURL, idx)
	if err := p.http.postJSON(ctx, softResetURL, map[string]any{}, nil); err != nil {
		return err
	}

	return nil
}

// ParseEmulatorResourceIDForProxy exposes the parsed base URL and device ID for
// backend-owned proxy endpoints. Callers must never return the base URL to clients.
func (p *EmulatorProvider) ParseEmulatorResourceIDForProxy(resourceID string) (string, string, error) {
	return p.parseEmulatorResourceID(resourceID)
}

func formatEmulatorResourceID(baseURL, deviceID string) string {
	return baseURL + "|" + deviceID
}

func (p *EmulatorProvider) parseEmulatorResourceID(resourceID string) (string, string, error) {
	resourceID = strings.TrimSpace(resourceID)
	if resourceID == "" {
		return "", "", fmt.Errorf("resource ID is empty")
	}

	parts := strings.SplitN(resourceID, "|", 2)
	if len(parts) == 2 {
		baseURL := strings.TrimRight(parts[0], "/")
		deviceID := strings.TrimSpace(parts[1])
		if baseURL == "" || deviceID == "" {
			return "", "", fmt.Errorf("resource ID is invalid")
		}
		return baseURL, deviceID, nil
	}

	if len(p.BaseURLs) == 1 {
		return p.BaseURLs[0], resourceID, nil
	}

	return "", "", fmt.Errorf("resource ID missing base URL")
}
