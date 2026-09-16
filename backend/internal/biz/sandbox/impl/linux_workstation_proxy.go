package impl

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/enum"
	"sico-backend/internal/shared/errcode"
	sandboxRgrpc "sico-backend/internal/transport/reverse_grpc/pb/sandbox"
)

func (s *Service) RpcProxyLinuxWorkstationSandboxHttp(
	ctx context.Context,
	req *sandboxRgrpc.LinuxWorkstationSandboxHttpRequest,
) (*sandboxRgrpc.LinuxWorkstationSandboxHttpResponse, error) {
	if req == nil {
		return &sandboxRgrpc.LinuxWorkstationSandboxHttpResponse{Code: 1, Msg: "request is required"}, nil
	}

	instanceID := strings.TrimSpace(req.GetAgentInstanceId())
	if instanceID == "" {
		return &sandboxRgrpc.LinuxWorkstationSandboxHttpResponse{Code: 1, Msg: "agentInstanceId is required"}, nil
	}

	method := strings.ToUpper(strings.TrimSpace(req.GetMethod()))
	if method == "" {
		method = http.MethodGet
	}
	if method != http.MethodGet && method != http.MethodPost && method != http.MethodPut &&
		method != http.MethodPatch && method != http.MethodDelete {
		return &sandboxRgrpc.LinuxWorkstationSandboxHttpResponse{Code: 1, Msg: "unsupported method: " + method}, nil
	}

	targetBase, err := s.resolveLinuxWorkstationProxyBase(ctx, instanceID, req.GetProxyBasePath())
	if err != nil {
		return &sandboxRgrpc.LinuxWorkstationSandboxHttpResponse{Code: 1, Msg: err.Error()}, nil
	}
	targetURL, err := buildLinuxWorkstationProxyTargetURL(targetBase, req.GetPath(), req.GetQueryJson())
	if err != nil {
		return &sandboxRgrpc.LinuxWorkstationSandboxHttpResponse{Code: 1, Msg: err.Error()}, nil
	}
	statusCode, contentType, body, err := proxyLinuxWorkstationHTTP(
		ctx, method, targetURL, req.GetJsonBodyJson(), req.GetFormFields(),
	)
	if err != nil {
		return &sandboxRgrpc.LinuxWorkstationSandboxHttpResponse{Code: 1, Msg: err.Error()}, nil
	}

	response := &sandboxRgrpc.LinuxWorkstationSandboxHttpResponse{
		StatusCode: int32(statusCode), ContentType: contentType, BodyBytes: body, Code: 0, Msg: "success",
	}
	if utf8.Valid(body) {
		response.BodyText = string(body)
	}
	return response, nil
}

func (s *Service) resolveLinuxWorkstationProxyBase(
	ctx context.Context,
	instanceID, proxyBasePath string,
) (string, error) {
	if s == nil {
		return "", apperr.New(errcode.SandboxProviderUnavailable, "sandbox provider unavailable")
	}
	rid, err := extractLinuxWorkstationProxyRID(proxyBasePath)
	if err != nil {
		return "", err
	}
	assigned, err := s.GetInstanceSandboxesWithStatus(ctx, instanceID, enum.SandboxOSLinux.String())
	if err != nil {
		return "", err
	}
	for _, sandbox := range assigned {
		endpoint := getMapString(sandbox, "endpoint")
		if extractRIDFromLinuxWorkstationEndpoint(endpoint) != rid {
			continue
		}
		sandboxID := getMapString(sandbox, "sandbox_id")
		realURL := strings.TrimRight(strings.TrimSpace(strings.TrimPrefix(
			sandboxID, enum.SandboxTypeLinuxWorkstation.String()+":")), "/")
		if realURL != "" {
			return realURL, nil
		}
	}
	return "", apperr.New(errcode.SandboxNoAvailableResource, "linux workstation resource not found")
}

func getMapString(values map[string]interface{}, key string) string {
	value, _ := values[key].(string)
	return strings.TrimSpace(value)
}

func extractRIDFromLinuxWorkstationEndpoint(endpoint string) string {
	parsed, err := url.Parse(strings.TrimSpace(endpoint))
	if err != nil {
		return ""
	}
	return extractLinuxWorkstationRIDFromPath(parsed.Path)
}

func extractLinuxWorkstationProxyRID(proxyBasePath string) (string, error) {
	raw := strings.TrimSpace(proxyBasePath)
	if raw == "" {
		return "", apperr.New(errcode.CommonInvalidParam, "proxyBasePath is required")
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return "", apperr.New(errcode.CommonInvalidParam, "invalid proxyBasePath")
	}
	rid := extractLinuxWorkstationRIDFromPath(parsed.Path)
	if rid == "" {
		if strings.HasPrefix(parsed.Path, linuxWorkstationProxyPrefix) {
			return "", apperr.New(
				errcode.CommonInvalidParam,
				"proxyBasePath must include Linux Workstation resource id",
			)
		}
		return "", apperr.New(errcode.CommonInvalidParam, "proxyBasePath must be a Linux Workstation resource proxy path")
	}
	return rid, nil
}

const linuxWorkstationProxyPrefix = "/api/sico/sandbox/resources/linux_workstation/"

func extractLinuxWorkstationRIDFromPath(path string) string {
	if !strings.HasPrefix(path, linuxWorkstationProxyPrefix) {
		return ""
	}
	remaining := strings.Trim(strings.TrimPrefix(path, linuxWorkstationProxyPrefix), "/")
	if remaining == "" {
		return ""
	}
	return strings.SplitN(remaining, "/", 2)[0]
}

func buildLinuxWorkstationProxyTargetURL(targetBase, reqPath, queryJSON string) (string, error) {
	target, err := url.Parse(strings.TrimSpace(targetBase))
	if err != nil || target.Scheme == "" || target.Host == "" {
		return "", apperr.New(errcode.CommonInvalidParam, "invalid linux workstation upstream base URL")
	}
	pathValue := strings.TrimSpace(reqPath)
	if pathValue == "" {
		pathValue = "/"
	}
	if !strings.HasPrefix(pathValue, "/") {
		pathValue = "/" + pathValue
	}
	target.Path = joinLinuxWorkstationProxyPath(target.Path, pathValue)

	if strings.TrimSpace(queryJSON) != "" {
		query, err := decodeQueryJSON(queryJSON)
		if err != nil {
			return "", err
		}
		encoded := url.Values{}
		for key, values := range query {
			for _, value := range values {
				encoded.Add(key, value)
			}
		}
		target.RawQuery = encoded.Encode()
	}
	return target.String(), nil
}

func decodeQueryJSON(raw string) (map[string][]string, error) {
	var decoded map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		return nil, apperr.New(errcode.CommonInvalidParam, "queryJson must be valid JSON")
	}
	result := map[string][]string{}
	for key, value := range decoded {
		switch typed := value.(type) {
		case nil:
			continue
		case []interface{}:
			for _, item := range typed {
				result[key] = append(result[key], fmt.Sprint(item))
			}
		default:
			result[key] = append(result[key], fmt.Sprint(typed))
		}
	}
	return result, nil
}

func proxyLinuxWorkstationHTTP(
	ctx context.Context,
	method, targetURL, jsonBodyJSON string,
	formFields []*sandboxRgrpc.LinuxWorkstationSandboxHttpFormField,
) (int, string, []byte, error) {
	const maxResponseBodySize = 10 * 1024 * 1024

	req, err := http.NewRequestWithContext(ctx, method, targetURL, nil)
	if err != nil {
		return 0, "", nil, err
	}
	if len(formFields) > 0 {
		buf, contentType, err := buildMultipartBody(formFields)
		if err != nil {
			return 0, "", nil, err
		}
		req.Body = io.NopCloser(buf)
		req.ContentLength = int64(buf.Len())
		req.Header.Set("Content-Type", contentType)
	} else if strings.TrimSpace(jsonBodyJSON) != "" {
		req.Body = io.NopCloser(strings.NewReader(jsonBodyJSON))
		req.ContentLength = int64(len(jsonBodyJSON))
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return 0, "", nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBodySize+1))
	if err != nil {
		return 0, "", nil, err
	}
	if int64(len(body)) > maxResponseBodySize {
		return 0, "", nil, fmt.Errorf(
			"linux workstation upstream response body exceeds %d bytes limit",
			maxResponseBodySize,
		)
	}
	return resp.StatusCode, resp.Header.Get("Content-Type"), body, nil
}

func buildMultipartBody(fields []*sandboxRgrpc.LinuxWorkstationSandboxHttpFormField) (*bytes.Buffer, string, error) {
	buf := &bytes.Buffer{}
	writer := multipart.NewWriter(buf)
	for _, field := range fields {
		if field == nil || strings.TrimSpace(field.GetName()) == "" {
			continue
		}
		if len(field.GetBytesValue()) > 0 || strings.TrimSpace(field.GetFileName()) != "" {
			if err := writeFilePart(writer, field); err != nil {
				return nil, "", err
			}
			continue
		}
		if err := writer.WriteField(field.GetName(), field.GetTextValue()); err != nil {
			return nil, "", err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, "", err
	}
	return buf, writer.FormDataContentType(), nil
}

func writeFilePart(writer *multipart.Writer, field *sandboxRgrpc.LinuxWorkstationSandboxHttpFormField) error {
	header := textproto.MIMEHeader{}
	fileName := strings.TrimSpace(field.GetFileName())
	if fileName == "" {
		fileName = field.GetName()
	}
	header.Set("Content-Disposition", fmt.Sprintf(`form-data; name=%q; filename=%q`, field.GetName(), fileName))
	contentType := strings.TrimSpace(field.GetContentType())
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	header.Set("Content-Type", contentType)
	part, err := writer.CreatePart(header)
	if err != nil {
		return err
	}
	_, err = part.Write(field.GetBytesValue())
	return err
}

func joinLinuxWorkstationProxyPath(left, right string) string {
	leftSlash, rightSlash := strings.HasSuffix(left, "/"), strings.HasPrefix(right, "/")
	switch {
	case leftSlash && rightSlash:
		return left + right[1:]
	case !leftSlash && !rightSlash:
		return left + "/" + right
	default:
		return left + right
	}
}
