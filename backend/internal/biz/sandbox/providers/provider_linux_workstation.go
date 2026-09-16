package providers

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	sandboximpl "sico-backend/internal/biz/sandbox/impl"
	"sico-backend/internal/shared/enum"
)

const sandboxLinuxWorkstationEndpoints = "SANDBOX_LINUX_WORKSTATION_ENDPOINTS"

type LinuxWorkstationProvider struct {
	endpoints []string
	workspace string
	http      *httpClient
	k8s       *linuxWorkstationK8sClient
}

func NewLinuxWorkstationProvider() *LinuxWorkstationProvider {
	parts := splitAndTrim(os.Getenv(sandboxLinuxWorkstationEndpoints))
	for i := range parts {
		parts[i] = strings.TrimRight(parts[i], "/")
	}
	return &LinuxWorkstationProvider{
		endpoints: parts,
		workspace: "/home/gem",
		http:      newHTTPClient(6 * time.Second),
		k8s:       newLinuxWorkstationK8sClient(),
	}
}

func (p *LinuxWorkstationProvider) Type() string { return enum.SandboxTypeLinuxWorkstation.String() }

func (p *LinuxWorkstationProvider) DisplayNamePrefix() string { return "Linux Workstation" }

func (p *LinuxWorkstationProvider) ListResources(ctx context.Context) ([]*sandboximpl.Resource, error) {
	if p == nil {
		return []*sandboximpl.Resource{}, nil
	}
	if p.k8s != nil {
		resources, err := p.k8s.ListResources(ctx, p.workspace)
		if err == nil {
			return resources, nil
		}
	}
	if len(p.endpoints) == 0 {
		return []*sandboximpl.Resource{}, nil
	}

	result := make([]*sandboximpl.Resource, 0, len(p.endpoints))
	for _, base := range p.endpoints {
		status := sandboximpl.ResourceStatusAvailable
		var healthResponse map[string]string
		if err := p.http.getJSON(ctx, base+"/health", &healthResponse); err != nil || healthResponse["status"] != "ok" {
			status = sandboximpl.ResourceStatusUnhealthy
		}
		result = append(result, &sandboximpl.Resource{
			Type:        p.Type(),
			ResourceID:  base,
			DisplayName: base,
			Status:      status,
			Metadata: map[string]string{
				"baseUrl": base, "directEndpoint": base, "workspace": p.workspace,
				"apiDocsUrl": base + "/v1/docs", "vncUrl": base + "/vnc/",
			},
		})
	}
	return result, nil
}

func (p *LinuxWorkstationProvider) ResetResource(ctx context.Context, resourceID string) error {
	if p == nil {
		return fmt.Errorf("linux workstation provider not configured")
	}
	base := strings.TrimRight(resourceID, "/")
	if base == "" {
		return fmt.Errorf("invalid linux workstation resource id")
	}
	_ = p.http.delete(ctx, base+"/v1/shell/sessions")
	workspace := p.workspace
	command := fmt.Sprintf(
		"rm -rf %s/* %s/.[!.]* %s/..?*",
		shellQuote(workspace),
		shellQuote(workspace),
		shellQuote(workspace),
	)
	return p.http.postJSON(ctx, base+"/v1/shell/exec", map[string]any{
		"command": command, "exec_dir": workspace, "async_mode": false, "timeout": 30,
	}, nil)
}

func (p *LinuxWorkstationProvider) RenderEndpoints(resourceID string, _ map[string]string) sandboximpl.ProviderEndpoints {
	if resourceID == "" {
		return sandboximpl.ProviderEndpoints{}
	}
	proxyBase := fmt.Sprintf("/api/sico/sandbox/resources/linux_workstation/%s", hashResourceID(resourceID))
	return sandboximpl.ProviderEndpoints{
		Endpoint:   proxyBase + "/",
		VNCURL:     proxyBase + "/?embed=1&panels=browser&layout=single",
		VNCOpenURL: proxyBase + "/",
	}
}

func (p *LinuxWorkstationProvider) OpenAPIURL(_ string, metadata map[string]string) string {
	endpoint := strings.TrimRight(metadata["directEndpoint"], "/")
	if endpoint == "" {
		return ""
	}
	return endpoint + enum.SandboxTypeLinuxWorkstation.OpenAPIPath()
}

func shellQuote(value string) string {
	_ = url.PathEscape(value)
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}
