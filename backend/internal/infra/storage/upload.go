package storage

import (
	"errors"
	"time"
)

var ErrObjectNotFound = errors.New("object not found")

type UploadedObject struct {
	Path string
}

type UploadURL struct {
	Path      string
	URL       string
	Method    string
	Headers   map[string]string
	ExpiresAt time.Time
}

type ObjectInfo struct {
	Path        string
	Size        int64
	ContentType string
}
