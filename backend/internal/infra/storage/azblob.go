package storage

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Azure/azure-sdk-for-go/sdk/azidentity"
	"github.com/Azure/azure-sdk-for-go/sdk/storage/azblob"
	"github.com/Azure/azure-sdk-for-go/sdk/storage/azblob/blob"
	"github.com/Azure/azure-sdk-for-go/sdk/storage/azblob/bloberror"
	"github.com/Azure/azure-sdk-for-go/sdk/storage/azblob/sas"
	"github.com/Azure/azure-sdk-for-go/sdk/storage/azblob/service"

	"sico-backend/internal/consts"
	"sico-backend/pkg/logger"
)

type azureBlobClient struct {
	endpoint    string
	cdnEndpoint string
	client      *azblob.Client
	container   string
	prefix      string
}

func newAzureBlob(
	_ context.Context,
	endpoint, container, cdnEndpoint string,
) (Storage, error) {
	credential, err := azidentity.NewDefaultAzureCredential(nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create Azure credential: %v", err)
	}
	client, err := azblob.NewClient(endpoint, credential, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create Azure Blob client: %v", err)
	}
	return &azureBlobClient{
		endpoint:    endpoint,
		cdnEndpoint: cdnEndpoint,
		client:      client,
		container:   container,
		prefix:      DefaultPathPrefix,
	}, nil
}

func buildPutOption(opts ...PutOptFn) *PutOption {
	putOpt := &PutOption{}
	for _, opt := range opts {
		opt(putOpt)
	}
	return putOpt
}

func buildPutHTTPHeaders(putOpt *PutOption) *blob.HTTPHeaders {
	headers := &blob.HTTPHeaders{}
	if putOpt.ContentType != nil {
		headers.BlobContentType = putOpt.ContentType
	}
	if putOpt.ContentEncoding != nil {
		headers.BlobContentEncoding = putOpt.ContentEncoding
	}
	if putOpt.ContentDisposition != nil {
		headers.BlobContentDisposition = putOpt.ContentDisposition
	}
	if putOpt.ContentLanguage != nil {
		headers.BlobContentLanguage = putOpt.ContentLanguage
	}
	return headers
}

func (a *azureBlobClient) buildPutObjectPath(objectKey string, putOpt *PutOption) string {
	prefix := a.prefix
	if putOpt.PathPrefix != nil {
		prefix = *putOpt.PathPrefix
	}
	return buildObjectPath(prefix, objectKey)
}

func (a *azureBlobClient) PutObject(ctx context.Context, objectKey string, content []byte, opts ...PutOptFn) (string, error) {
	putOpt := buildPutOption(opts...)
	path := a.buildPutObjectPath(objectKey, putOpt)
	_, err := a.client.UploadBuffer(ctx, a.container, path, content, &azblob.UploadBufferOptions{
		HTTPHeaders: buildPutHTTPHeaders(putOpt),
	})
	if err != nil {
		return "", fmt.Errorf("PutObject failed: %v", err)
	}
	return path, nil
}

func (a *azureBlobClient) UploadObject(
	ctx context.Context,
	objectKey string,
	content io.Reader,
	opts ...PutOptFn,
) (*UploadedObject, error) {
	putOpt := buildPutOption(opts...)
	path := a.buildPutObjectPath(objectKey, putOpt)
	_, err := a.client.UploadStream(ctx, a.container, path, content, &azblob.UploadStreamOptions{
		HTTPHeaders: buildPutHTTPHeaders(putOpt),
	})
	if err != nil {
		return nil, fmt.Errorf("UploadObject failed: %v", err)
	}
	return &UploadedObject{Path: path}, nil
}

func (a *azureBlobClient) CreateUploadURL(
	ctx context.Context,
	objectKey string,
	opts ...PutOptFn,
) (*UploadURL, error) {
	putOpt := buildPutOption(opts...)
	path := a.buildPutObjectPath(objectKey, putOpt)
	expiresAt := time.Now().Add(time.Hour)
	if putOpt.Expires != nil {
		if putOpt.Expires.IsZero() {
			return nil, fmt.Errorf("invalid expire time: zero time")
		}
		if putOpt.Expires.Before(time.Now()) {
			return nil, fmt.Errorf("invalid expire time: cannot be in the past")
		}
		expiresAt = *putOpt.Expires
	}
	uploadURL, err := a.generateUserDelegationSAS(ctx, path, expiresAt, sas.BlobPermissions{Create: true, Write: true})
	if err != nil {
		return nil, fmt.Errorf("failed to generate upload SAS: %v", err)
	}
	headers := map[string]string{"x-ms-blob-type": "BlockBlob"}
	if putOpt.ContentType != nil && *putOpt.ContentType != "" {
		headers["x-ms-blob-content-type"] = *putOpt.ContentType
	}
	return &UploadURL{Path: path, URL: uploadURL, Method: http.MethodPut, Headers: headers, ExpiresAt: expiresAt}, nil
}

func (a *azureBlobClient) GetObjectInfo(ctx context.Context, objectKey string, opts ...GetOptFn) (*ObjectInfo, error) {
	getOpt := &GetOption{}
	for _, opt := range opts {
		opt(getOpt)
	}
	prefix := a.prefix
	if getOpt.PathPrefix != nil {
		prefix = *getOpt.PathPrefix
	}
	path := buildObjectPath(prefix, objectKey)
	response, err := a.client.ServiceClient().NewContainerClient(a.container).NewBlobClient(path).GetProperties(ctx, nil)
	if err != nil {
		if bloberror.HasCode(err, bloberror.BlobNotFound) {
			return nil, ErrObjectNotFound
		}
		return nil, fmt.Errorf("GetObjectInfo failed: %v", err)
	}
	info := &ObjectInfo{Path: path}
	if response.ContentLength != nil {
		info.Size = *response.ContentLength
	}
	if response.ContentType != nil {
		info.ContentType = *response.ContentType
	}
	return info, nil
}

func (a *azureBlobClient) GetObject(ctx context.Context, objectKey string, opts ...GetOptFn) ([]byte, error) {
	getOpt := &GetOption{}
	for _, opt := range opts {
		opt(getOpt)
	}
	prefix := a.prefix
	if getOpt.PathPrefix != nil {
		prefix = *getOpt.PathPrefix
	}
	response, err := a.client.DownloadStream(ctx, a.container, buildObjectPath(prefix, objectKey), nil)
	if err != nil {
		return nil, fmt.Errorf("GetObject failed: %v", err)
	}
	defer func() {
		if closeErr := response.Body.Close(); closeErr != nil {
			logger.CtxWarn(ctx, "failed to close GetObject response body: %v", closeErr)
		}
	}()
	buffer, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %v", err)
	}
	return buffer, nil
}

func (a *azureBlobClient) DeleteObject(ctx context.Context, objectKey string, opts ...DelOptFn) error {
	delOpt := &DelOption{}
	for _, opt := range opts {
		opt(delOpt)
	}
	prefix := a.prefix
	if delOpt.PathPrefix != nil {
		prefix = *delOpt.PathPrefix
	}
	_, err := a.client.DeleteBlob(ctx, a.container, buildObjectPath(prefix, objectKey), nil)
	if err != nil {
		return fmt.Errorf("DeleteObject failed: %v", err)
	}
	return nil
}

func (a *azureBlobClient) DelObjectByPath(ctx context.Context, path string) error {
	_, err := a.client.DeleteBlob(ctx, a.container, path, nil)
	if err != nil {
		return fmt.Errorf("DelObjectByPath failed: %v", err)
	}
	return nil
}

func (a *azureBlobClient) GetObjectUrl(ctx context.Context, objectKey string, opts ...GetOptFn) (string, error) {
	getOpt := &GetOption{}
	for _, opt := range opts {
		opt(getOpt)
	}
	prefix := a.prefix
	if getOpt.PathPrefix != nil {
		prefix = *getOpt.PathPrefix
	}
	path := buildObjectPath(prefix, objectKey)
	if cdnURL := a.buildCDNURL(path); cdnURL != "" {
		return cdnURL, nil
	}
	expiresAt := time.Now().Add(3 * time.Hour)
	if getOpt.Expire != nil {
		if getOpt.Expire.IsZero() {
			return "", fmt.Errorf("invalid expire time: zero time")
		}
		if getOpt.Expire.Before(time.Now()) {
			return "", fmt.Errorf("invalid expire time: cannot be in the past")
		}
		expiresAt = *getOpt.Expire
	}
	sasURL, err := a.generateUserDelegationSAS(
		ctx,
		path,
		expiresAt,
		sas.BlobPermissions{Read: true},
	)
	if err != nil {
		return "", fmt.Errorf("failed to generateUserDelegationSAS: %v", err)
	}
	return sasURL, nil
}

func (a *azureBlobClient) GetObjectUrlByPath(ctx context.Context, path string) (string, error) {
	if cdnURL := a.buildCDNURL(path); cdnURL != "" {
		return cdnURL, nil
	}
	sasURL, err := a.generateUserDelegationSAS(ctx, path, time.Now().Add(24*time.Hour), sas.BlobPermissions{Read: true})
	if err != nil {
		return "", fmt.Errorf("failed to generateUserDelegationSAS: %v", err)
	}
	return sasURL, nil
}

func (a *azureBlobClient) buildCDNURL(path string) string {
	cdnEndpoint := strings.TrimRight(strings.TrimSpace(a.cdnEndpoint), "/")
	if cdnEndpoint == "" {
		return ""
	}

	segments := strings.Split(strings.TrimPrefix(path, "/"), "/")
	for i := range segments {
		segments[i] = url.PathEscape(segments[i])
	}
	return fmt.Sprintf("%s/%s/%s", cdnEndpoint, url.PathEscape(a.container), strings.Join(segments, "/"))
}

func (a *azureBlobClient) generateUserDelegationSAS(
	ctx context.Context,
	blobPath string,
	expiresAt time.Time,
	permissions sas.BlobPermissions,
) (string, error) {
	startTime := time.Now().UTC()
	startTimeString := startTime.Format(consts.ISO8601Format)
	expiresAtString := expiresAt.Format(consts.ISO8601Format)
	userDelegationKey, err := a.client.ServiceClient().GetUserDelegationCredential(ctx, service.KeyInfo{
		Start: &startTimeString, Expiry: &expiresAtString,
	}, nil)
	if err != nil {
		return "", fmt.Errorf("failed to get user delegation key: %v", err)
	}
	sasQueryParams, err := sas.BlobSignatureValues{
		Protocol: sas.ProtocolHTTPS, StartTime: startTime, ExpiryTime: expiresAt,
		Permissions: permissions.String(), ContainerName: a.container, BlobName: blobPath,
	}.SignWithUserDelegation(userDelegationKey)
	if err != nil {
		return "", fmt.Errorf("failed to sign SAS with user delegation key: %v", err)
	}
	escapedBlobPath := url.PathEscape(blobPath)
	blobURL := fmt.Sprintf("%s/%s/%s", strings.TrimSuffix(a.endpoint, "/"), a.container, escapedBlobPath)
	return fmt.Sprintf("%s?%s", blobURL, sasQueryParams.Encode()), nil
}
