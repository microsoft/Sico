package types

// FileExtraInfo holds metadata that accompanies uploaded assets.
type FileExtraInfo struct {
	FileName    string `json:"file_name"`
	FileSize    int64  `json:"file_size"`
	ContentType string `json:"content_type"`
	FileExt     string `json:"file_ext"`
	FileType    string `json:"file_type"`
	// SHA256 is the hex-encoded SHA-256 digest of the uploaded file content.
	// Optional: only set by callers that want content-based identity checks.
	SHA256 string `json:"sha256,omitempty"`
}
