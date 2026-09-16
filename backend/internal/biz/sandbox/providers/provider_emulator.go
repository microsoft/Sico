package providers

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	sandboximpl "sico-backend/internal/biz/sandbox/impl"
	"sico-backend/internal/consts"
	"sico-backend/internal/shared/enum"
	"sico-backend/pkg/env"
)

const sandboxServiceTokenEnv = "SICO_SANDBOX_SERVICE_TOKEN"
const sandboxServiceTokenError = sandboxServiceTokenEnv + " must be exactly 64 lowercase hexadecimal characters"

type EmulatorProvider struct {
	BaseURLs     []string
	http         *httpClient
	appHTTP      *httpClient
	serviceToken string
}

func NewEmulatorProvider() *EmulatorProvider {
	parts := splitAndTrim(env.GetOrDefault(consts.SandboxEmulatorBaseURL, ""))
	for i := range parts {
		parts[i] = strings.TrimRight(parts[i], "/")
	}
	token := os.Getenv(sandboxServiceTokenEnv)
	if !isValidSandboxServiceToken(token) {
		panic(sandboxServiceTokenError)
	}
	return &EmulatorProvider{
		BaseURLs:     parts,
		http:         newAuthenticatedHTTPClient(8*time.Second, token),
		appHTTP:      newAuthenticatedHTTPClient(10*time.Minute+30*time.Second, token),
		serviceToken: token,
	}
}

func isValidSandboxServiceToken(token string) bool {
	if len(token) != 64 {
		return false
	}
	for _, char := range token {
		if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
			return false
		}
	}
	return true
}

func (p *EmulatorProvider) appClient() *httpClient {
	if p.appHTTP != nil {
		return p.appHTTP
	}
	return p.http
}

func (p *EmulatorProvider) Type() string { return enum.SandboxTypeEmulator.String() }

func (p *EmulatorProvider) DisplayNamePrefix() string { return "Android-Device" }

func (p *EmulatorProvider) RenderEndpoints(
	resourceID string,
	metadata map[string]string,
) sandboximpl.ProviderEndpoints {
	if metadata == nil {
		return sandboximpl.ProviderEndpoints{}
	}
	baseURL := metadata["providerBaseUrl"]
	if baseURL == "" {
		return sandboximpl.ProviderEndpoints{}
	}

	endpoints := sandboximpl.ProviderEndpoints{}
	if metadata["adbPort"] != "" {
		endpoints.Endpoint = fmt.Sprintf("%s:%s", extractHostFromURL(baseURL), metadata["adbPort"])
	}
	rid := hashResourceID(resourceID)
	endpoints.VNCURL = fmt.Sprintf("/api/sico/sandbox/resources/emulator/%s/vnc", rid)
	endpoints.VNCOpenURL = endpoints.VNCURL
	return endpoints
}

func (p *EmulatorProvider) OpenAPIURL(_ string, metadata map[string]string) string {
	if metadata == nil || metadata["providerBaseUrl"] == "" {
		return ""
	}
	return metadata["providerBaseUrl"] + enum.SandboxTypeEmulator.OpenAPIPath()
}

func (p *EmulatorProvider) OpenAPIBearerToken(_ string, _ map[string]string) string {
	return p.serviceToken
}

func (p *EmulatorProvider) enabled() bool { return p != nil && len(p.BaseURLs) > 0 }

type emulatorDevicesResponse struct {
	Devices []struct {
		DeviceIndex int    `json:"device_index"`
		AdbHost     string `json:"adb_host"`
		AdbPort     int    `json:"adb_port"`
	} `json:"devices"`
}

func (p *EmulatorProvider) ListResources(ctx context.Context) ([]*sandboximpl.Resource, error) {
	if !p.enabled() {
		return []*sandboximpl.Resource{}, nil
	}

	resources := make([]*sandboximpl.Resource, 0)
	attempted, succeeded := 0, 0
	var firstErr error
	for _, baseURL := range p.BaseURLs {
		if baseURL == "" {
			continue
		}
		attempted++
		var response emulatorDevicesResponse
		if err := p.http.getJSON(ctx, baseURL+"/vnc/devices", &response); err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		succeeded++
		for _, device := range response.Devices {
			deviceID := strconv.Itoa(device.DeviceIndex)
			metadata := map[string]string{"providerBaseUrl": baseURL, "deviceId": deviceID}
			if device.AdbHost != "" && device.AdbPort > 0 {
				metadata["adbHost"] = device.AdbHost
				metadata["adbPort"] = strconv.Itoa(device.AdbPort)
				metadata["adbAddress"] = fmt.Sprintf("%s:%d", device.AdbHost, device.AdbPort)
			}
			resources = append(resources, &sandboximpl.Resource{
				Type: p.Type(), ResourceID: formatEmulatorResourceID(baseURL, deviceID),
				DisplayName: fmt.Sprintf("Android Device #%d", device.DeviceIndex),
				Status:      sandboximpl.ResourceStatusAvailable, Metadata: metadata,
			})
		}
	}
	if attempted > 0 && succeeded == 0 && firstErr != nil {
		return nil, fmt.Errorf("failed to list emulator resources from all configured endpoints: %w", firstErr)
	}
	return resources, nil
}

func (p *EmulatorProvider) ResetResource(ctx context.Context, resourceID string) error {
	if !p.enabled() {
		return fmt.Errorf("emulator provider not configured")
	}
	baseURL, deviceID, err := p.ParseResourceIDForProxy(resourceID)
	if err != nil {
		return fmt.Errorf("invalid emulator resource id: %w", err)
	}
	deviceIndex, err := strconv.Atoi(deviceID)
	if err != nil {
		return fmt.Errorf("invalid emulator device index: %w", err)
	}
	return p.http.postJSON(
		ctx,
		fmt.Sprintf("%s/api/v1/emulators/%d/soft-reset", baseURL, deviceIndex),
		map[string]any{},
		nil,
	)
}

func (p *EmulatorProvider) ParseResourceIDForProxy(resourceID string) (string, string, error) {
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

func formatEmulatorResourceID(baseURL, deviceID string) string { return baseURL + "|" + deviceID }
