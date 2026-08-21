package handler

import (
	"context"

	sandboxbiz "sico-backend/internal/biz/sandbox"
	commondto "sico-backend/internal/transport/http/dto/common"
)

func getInstanceSandboxes(ctx context.Context, instanceID string) []*commondto.SandboxDigest {
	svc := sandboxbiz.Default()
	if svc == nil {
		return nil
	}

	sandboxes, err := svc.GetInstanceSandboxesWithStatus(ctx, instanceID, "")
	if err != nil || len(sandboxes) == 0 {
		return nil
	}

	var result []*commondto.SandboxDigest
	for _, sb := range sandboxes {
		info := &commondto.SandboxDigest{
			SandboxId:   getStringFromMap(sb, "sandbox_id"),
			Type:        getStringFromMap(sb, "type"),
			Status:      getStringFromMap(sb, "status"),
			Endpoint:    getStringFromMap(sb, "endpoint"),
			VncUrl:      getStringFromMap(sb, "vnc_url"),
			DocsUrl:     getStringFromMap(sb, "docs_url"),
			DisplayName: getStringFromMap(sb, "display_name"),
		}
		result = append(result, info)
	}
	return result
}

func getStringFromMap(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}
