package storage

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strings"
	"time"

	"sico-backend/pkg/logger"
)

type seaweedFSClient struct {
	endpoint   string
	httpClient *http.Client
	prefix     string
}

// publicURLPrefix is the same-origin path under which sico-nginx exposes the
// SeaweedFS filer to browsers. URLs handed back to clients (GetObjectUrl*)
// use this prefix so the browser can fetch them via the reverse proxy
// instead of hitting the cluster-internal filer hostname directly.
const publicURLPrefix = "/storage"

func newSeaweedFS(_ context.Context, endpoint string) (Storage, error) {
	endpoint = strings.TrimSuffix(endpoint, "/")

	return &seaweedFSClient{
		endpoint:   endpoint,
		httpClient: &http.Client{},
		prefix:     DefaultPathPrefix,
	}, nil
}

func (s *seaweedFSClient) buildURL(objectPath string) string {
	return fmt.Sprintf("%s/%s", s.endpoint, strings.TrimPrefix(objectPath, "/"))
}

// buildPublicURL renders a same-origin path that browsers can use to fetch
// the object via sico-nginx (which proxies /storage/ to the internal filer).
func buildPublicURL(objectPath string) string {
	return fmt.Sprintf("%s/%s", publicURLPrefix, strings.TrimPrefix(objectPath, "/"))
}

func (s *seaweedFSClient) PutObject(ctx context.Context, objectKey string, content []byte, opts ...PutOptFn) (string, error) {
	putOpt := &PutOption{}
	for _, opt := range opts {
		opt(putOpt)
	}

	prefix := s.prefix
	if putOpt.PathPrefix != nil {
		prefix = *putOpt.PathPrefix
	}

	path := buildObjectPath(prefix, objectKey)
	fileURL := s.buildURL(path)

	// Build multipart form body
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)

	partContentType := "application/octet-stream"
	if putOpt.ContentType != nil {
		partContentType = *putOpt.ContentType
	}

	partHeader := make(textproto.MIMEHeader)
	partHeader.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="%s"`, objectKey))
	partHeader.Set("Content-Type", partContentType)

	part, err := writer.CreatePart(partHeader)
	if err != nil {
		return "", fmt.Errorf("PutObject: failed to create form file: %v", err)
	}

	if _, err := part.Write(content); err != nil {
		return "", fmt.Errorf("PutObject: failed to write content: %v", err)
	}

	if err := writer.Close(); err != nil {
		return "", fmt.Errorf("PutObject: failed to close multipart writer: %v", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, fileURL, &body)
	if err != nil {
		return "", fmt.Errorf("PutObject: failed to create request: %v", err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("PutObject failed: %v", err)
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			logger.CtxError(ctx, "failed to close PutObject response body: %v", closeErr)
		}
	}()

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("PutObject failed with status %d: %s", resp.StatusCode, string(respBody))
	}

	return path, nil
}

func (s *seaweedFSClient) UploadObject(
	ctx context.Context,
	objectKey string,
	content io.Reader,
	opts ...PutOptFn,
) (*UploadedObject, error) {
	putOpt := &PutOption{}
	for _, opt := range opts {
		opt(putOpt)
	}

	prefix := s.prefix
	if putOpt.PathPrefix != nil {
		prefix = *putOpt.PathPrefix
	}
	path := buildObjectPath(prefix, objectKey)

	req, err := http.NewRequestWithContext(ctx, http.MethodPut, s.buildURL(path), content)
	if err != nil {
		return nil, fmt.Errorf("UploadObject: failed to create request: %v", err)
	}
	if putOpt.ContentType != nil {
		req.Header.Set("Content-Type", *putOpt.ContentType)
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("UploadObject failed: %v", err)
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			logger.CtxError(ctx, "failed to close UploadObject response body: %v", closeErr)
		}
	}()
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("UploadObject failed with status %d: %s", resp.StatusCode, string(respBody))
	}

	return &UploadedObject{Path: path}, nil
}

func (s *seaweedFSClient) CreateUploadURL(
	_ context.Context,
	objectKey string,
	opts ...PutOptFn,
) (*UploadURL, error) {
	putOpt := &PutOption{}
	for _, opt := range opts {
		opt(putOpt)
	}

	prefix := s.prefix
	if putOpt.PathPrefix != nil {
		prefix = *putOpt.PathPrefix
	}
	path := buildObjectPath(prefix, objectKey)
	expiresAt := time.Now().Add(time.Hour)
	if putOpt.Expires != nil {
		expiresAt = *putOpt.Expires
	}
	headers := map[string]string{}
	if putOpt.ContentType != nil && *putOpt.ContentType != "" {
		headers["Content-Type"] = *putOpt.ContentType
	}

	return &UploadURL{
		Path:      path,
		URL:       buildPublicURL(path),
		Method:    http.MethodPut,
		Headers:   headers,
		ExpiresAt: expiresAt,
	}, nil
}

func (s *seaweedFSClient) GetObjectInfo(
	ctx context.Context,
	objectKey string,
	opts ...GetOptFn,
) (*ObjectInfo, error) {
	getOpt := &GetOption{}
	for _, opt := range opts {
		opt(getOpt)
	}

	prefix := s.prefix
	if getOpt.PathPrefix != nil {
		prefix = *getOpt.PathPrefix
	}
	path := buildObjectPath(prefix, objectKey)
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, s.buildURL(path), nil)
	if err != nil {
		return nil, fmt.Errorf("GetObjectInfo: failed to create request: %v", err)
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("GetObjectInfo failed: %v", err)
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			logger.CtxError(ctx, "failed to close GetObjectInfo response body: %v", closeErr)
		}
	}()
	if resp.StatusCode == http.StatusNotFound {
		return nil, ErrObjectNotFound
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GetObjectInfo failed with status %d", resp.StatusCode)
	}

	return &ObjectInfo{Path: path, Size: resp.ContentLength, ContentType: resp.Header.Get("Content-Type")}, nil
}

func (s *seaweedFSClient) GetObject(ctx context.Context, objectKey string, opts ...GetOptFn) ([]byte, error) {
	getOpt := &GetOption{}
	for _, opt := range opts {
		opt(getOpt)
	}

	prefix := s.prefix
	if getOpt.PathPrefix != nil {
		prefix = *getOpt.PathPrefix
	}

	fileURL := s.buildURL(buildObjectPath(prefix, objectKey))

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fileURL, nil)
	if err != nil {
		return nil, fmt.Errorf("GetObject: failed to create request: %v", err)
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("GetObject failed: %v", err)
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			logger.CtxError(ctx, "failed to close GetObject response body: %v", closeErr)
		}
	}()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("GetObject failed with status %d: %s", resp.StatusCode, string(respBody))
	}

	buffer, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %v", err)
	}

	return buffer, nil
}

func (s *seaweedFSClient) DeleteObject(ctx context.Context, objectKey string, opts ...DelOptFn) error {
	delOpt := &DelOption{}
	for _, opt := range opts {
		opt(delOpt)
	}

	prefix := s.prefix
	if delOpt.PathPrefix != nil {
		prefix = *delOpt.PathPrefix
	}

	fileURL := s.buildURL(buildObjectPath(prefix, objectKey))

	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, fileURL, nil)
	if err != nil {
		return fmt.Errorf("DeleteObject: failed to create request: %v", err)
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("DeleteObject failed: %v", err)
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			logger.CtxError(ctx, "failed to close DeleteObject response body: %v", closeErr)
		}
	}()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusAccepted && resp.StatusCode != http.StatusNoContent {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("DeleteObject failed with status %d: %s", resp.StatusCode, string(respBody))
	}

	return nil
}

func (s *seaweedFSClient) DelObjectByPath(ctx context.Context, path string) error {
	fileURL := s.buildURL(path)

	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, fileURL, nil)
	if err != nil {
		return fmt.Errorf("DelObjectByPath: failed to create request: %v", err)
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("DelObjectByPath failed: %v", err)
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			logger.CtxError(ctx, "failed to close DelObjectByPath response body: %v", closeErr)
		}
	}()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusAccepted && resp.StatusCode != http.StatusNoContent {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("DelObjectByPath failed with status %d: %s", resp.StatusCode, string(respBody))
	}

	return nil
}

func (s *seaweedFSClient) GetObjectUrl(_ context.Context, objectKey string, opts ...GetOptFn) (string, error) {
	getOpt := &GetOption{}
	for _, opt := range opts {
		opt(getOpt)
	}

	prefix := s.prefix
	if getOpt.PathPrefix != nil {
		prefix = *getOpt.PathPrefix
	}

	return s.buildURL(buildObjectPath(prefix, objectKey)), nil
}

func (s *seaweedFSClient) GetObjectUrlByPath(_ context.Context, path string) (string, error) {
	return s.buildURL(path), nil
}
