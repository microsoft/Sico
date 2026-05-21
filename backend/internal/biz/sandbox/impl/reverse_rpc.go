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
	"strings"

	"sico-backend/internal/shared/enum"
	sandboxRgrpc "sico-backend/internal/transport/reverse_grpc/pb/sandbox"
)

func (s *Service) RpcApplySandbox(
	ctx context.Context, req *sandboxRgrpc.ApplySandboxRequest,
) (*sandboxRgrpc.ApplySandboxResponse, error) {
	if req == nil {
		return &sandboxRgrpc.ApplySandboxResponse{Code: 1, Msg: "request is required"}, nil
	}

	instanceID := strings.TrimSpace(req.GetInstanceId())
	if instanceID == "" {
		return &sandboxRgrpc.ApplySandboxResponse{Code: 1, Msg: "instanceId is required"}, nil
	}

	sandboxType := strings.TrimSpace(req.GetType())
	if sandboxType == "" {
		return &sandboxRgrpc.ApplySandboxResponse{Code: 1, Msg: "type is required"}, nil
	}
	if !enum.IsValidSandboxType(sandboxType) {
		return &sandboxRgrpc.ApplySandboxResponse{Code: 1, Msg: "invalid sandbox type: " + sandboxType}, nil
	}

	appliedSandbox, err := s.ApplySandbox(ctx, instanceID, sandboxType)
	if err != nil {
		return &sandboxRgrpc.ApplySandboxResponse{Code: 1, Msg: err.Error()}, nil
	}

	applied, appliedSandboxID := getApplyOutcome(appliedSandbox)
	msg := "success"
	if !applied {
		msg = "no available sandbox for requested type"
	}
	providerBaseURL, deviceID := getApplyMetadata(appliedSandbox)

	return &sandboxRgrpc.ApplySandboxResponse{
		Applied:          applied,
		AppliedSandboxId: appliedSandboxID,
		Endpoint:         getStr(appliedSandbox, "endpoint"),
		ProviderBaseUrl:  providerBaseURL,
		DeviceId:         deviceID,
		DisplayName:      getStr(appliedSandbox, "display_name"),
		VncUrl:           getStr(appliedSandbox, "vnc_url"),
		Code:             0,
		Msg:              msg,
	}, nil
}

func (s *Service) RpcReleaseSandbox(
	ctx context.Context, req *sandboxRgrpc.ReleaseSandboxRequest,
) (*sandboxRgrpc.ReleaseSandboxResponse, error) {
	if req == nil {
		return &sandboxRgrpc.ReleaseSandboxResponse{Code: 1, Msg: "request is required"}, nil
	}

	instanceID := strings.TrimSpace(req.GetInstanceId())
	sandboxID := strings.TrimSpace(req.GetSandboxId())
	if instanceID == "" || sandboxID == "" {
		return &sandboxRgrpc.ReleaseSandboxResponse{Code: 1, Msg: "instanceId and sandboxId are required"}, nil
	}

	if err := s.ReleaseSandbox(ctx, instanceID, sandboxID); err != nil {
		return &sandboxRgrpc.ReleaseSandboxResponse{Code: 1, Msg: err.Error()}, nil
	}

	return &sandboxRgrpc.ReleaseSandboxResponse{
		Code: 0,
		Msg:  "success",
	}, nil
}

// RpcResetSandbox implements the ReverseSandboxRPC gRPC server method.
// It soft-resets a sandbox (e.g. close apps, go home for emulator) while preserving the lease and assignment.
func (s *Service) RpcResetSandbox(
	ctx context.Context, req *sandboxRgrpc.ResetSandboxRequest,
) (*sandboxRgrpc.ResetSandboxResponse, error) {
	if req == nil {
		return &sandboxRgrpc.ResetSandboxResponse{Code: 1, Msg: "request is required"}, nil
	}

	instanceID := strings.TrimSpace(req.GetInstanceId())
	sandboxID := strings.TrimSpace(req.GetSandboxId())
	if instanceID == "" || sandboxID == "" {
		return &sandboxRgrpc.ResetSandboxResponse{Code: 1, Msg: "instanceId and sandboxId are required"}, nil
	}

	if err := s.ResetSandbox(ctx, instanceID, sandboxID); err != nil {
		return &sandboxRgrpc.ResetSandboxResponse{Code: 1, Msg: err.Error()}, nil
	}

	return &sandboxRgrpc.ResetSandboxResponse{
		Code: 0,
		Msg:  "success",
	}, nil
}

// RpcGetInstanceSandboxes implements the ReverseSandboxRPC gRPC server method.
// It returns all sandboxes assigned to the given instance with type, status, and endpoint info.
func (s *Service) RpcGetInstanceSandboxes(
	ctx context.Context, req *sandboxRgrpc.GetInstanceSandboxesRequest,
) (*sandboxRgrpc.GetInstanceSandboxesResponse, error) {
	if req == nil {
		return &sandboxRgrpc.GetInstanceSandboxesResponse{Code: 1, Msg: "request is required"}, nil
	}

	instanceID := strings.TrimSpace(req.GetInstanceId())
	if instanceID == "" {
		return &sandboxRgrpc.GetInstanceSandboxesResponse{Code: 1, Msg: "instanceId is required"}, nil
	}

	sandboxes, err := s.GetInstanceSandboxesWithStatus(ctx, instanceID, strings.TrimSpace(req.GetType()))
	if err != nil {
		return &sandboxRgrpc.GetInstanceSandboxesResponse{
			Code: 1,
			Msg:  err.Error(),
		}, nil
	}

	return &sandboxRgrpc.GetInstanceSandboxesResponse{
		Sandboxes: toInstanceSandboxInfos(sandboxes),
		Code:      0,
		Msg:       "success",
	}, nil
}

func toInstanceSandboxInfos(sandboxes []map[string]interface{}) []*sandboxRgrpc.InstanceSandboxInfo {
	infos := make([]*sandboxRgrpc.InstanceSandboxInfo, 0, len(sandboxes))
	for _, sb := range sandboxes {
		info := &sandboxRgrpc.InstanceSandboxInfo{
			SandboxId:   getStr(sb, "sandbox_id"),
			Type:        getStr(sb, "type"),
			Status:      getStr(sb, "status"),
			Endpoint:    getStr(sb, "endpoint"),
			VncUrl:      getStr(sb, "vnc_url"),
			DocsUrl:     getStr(sb, "docs_url"),
			DisplayName: getStr(sb, "display_name"),
		}
		infos = append(infos, info)
	}
	return infos
}

func getStr(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func getApplyOutcome(appliedSandbox map[string]interface{}) (bool, string) {
	if len(appliedSandbox) == 0 {
		return false, ""
	}

	sandboxID := getStr(appliedSandbox, "sandbox_id")
	if sandboxID == "" {
		return false, ""
	}

	return true, sandboxID
}

func getApplyMetadata(appliedSandbox map[string]interface{}) (string, string) {
	metadata, ok := appliedSandbox["metadata"].(map[string]string)
	if ok {
		return metadata["providerBaseUrl"], metadata["deviceId"]
	}

	metadataAny, ok := appliedSandbox["metadata"].(map[string]interface{})
	if !ok {
		return "", ""
	}

	return getStr(metadataAny, "providerBaseUrl"), getStr(metadataAny, "deviceId")
}
