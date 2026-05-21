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

package handler

import (
	"mime/multipart"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"

	projectSVC "sico-backend/internal/biz/project"
	"sico-backend/internal/transport/http/dto/project"
	"sico-backend/internal/transport/http/middleware"
	"sico-backend/pkg/logger"
)

// AddProjectAsset adds a new project asset
// @Router /api/sico/project/asset [POST]
// @Tags Project
// @Accept multipart/form-data
// @Produce json
// @Param project_id formData string false "Project ID"
// @Param file formData file true "File to upload"
// @Success 200 {object} project.AddProjectAssetResponse
func AddProjectAsset(ctx *gin.Context) {
	// Check if user is authenticated and get user info
	userInfo, _ := middleware.GetUserFromContext(ctx)

	err := ctx.Request.ParseMultipartForm(16 << 20) // 16 MB max memory
	if err != nil {
		invalidParamRequestResponse(ctx, "Failed to parse multipart form: "+err.Error())
		return
	}

	// Get project_id from form
	projectID := ctx.PostForm("project_id")

	// Get file from form
	file, header, err := ctx.Request.FormFile("file")
	if err != nil {
		invalidParamRequestResponse(ctx, "Failed to get file: "+err.Error())
		return
	}
	defer func(file multipart.File) {
		err := file.Close()
		if err != nil {
			logger.Error("Failed to close file, err:%v", err)
		}
	}(file)

	fileExtra, err := parseFileInfo(header)
	if err != nil {
		invalidParamRequestResponse(ctx, "Failed to parse file info: "+err.Error())
		return
	}

	req := &project.AddProjectAssetRequest{
		ProjectId: projectID,
	}

	resp, err := projectSVC.Default().AddProjectAsset(reqctx(ctx), req, userInfo.Name, file, fileExtra)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// GetProjectSASAsset .
// @Router /api/sico/project/sas_asset [GET]
// @Tags Project
// @Accept json
// @Produce json
// @Param request query project.GetProjectSASAssetRequest true "Get project SASAsset request"
// @Success 200 {object} project.GetProjectSASAssetResponse
func GetProjectSASAsset(ctx *gin.Context) {
	var req project.GetProjectSASAssetRequest
	err := ctx.ShouldBindQuery(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := projectSVC.Default().GetProjectSASAsset(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// parseFileInfo extracts file information and returns object_key, object_type, and extra JSON
func parseFileInfo(header *multipart.FileHeader) (projectSVC.FileExtraInfo, error) {
	fileName := header.Filename
	fileSize := header.Size
	contentType := header.Header.Get("Content-Type")
	fileExt := strings.ToLower(strings.TrimPrefix(filepath.Ext(fileName), "."))
	fileType := detectFileType(contentType, fileExt)

	extraInfo := projectSVC.FileExtraInfo{
		FileName:    fileName,
		FileSize:    fileSize,
		ContentType: contentType,
		FileExt:     fileExt,
		FileType:    fileType,
	}

	return extraInfo, nil
}

// mimeTypeToFileType maps explicit MIME types (non-prefix) to a file type label.
var mimeTypeToFileType = map[string]string{
	"application/pdf":    "document",
	"application/msword": "document",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
	"application/vnd.ms-excel": "document",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":         "document",
	"application/vnd.ms-powerpoint":                                             "document",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation": "document",
	"application/zip":              "archive",
	"application/x-zip-compressed": "archive",
	"application/x-rar-compressed": "archive",
	"application/x-7z-compressed":  "archive",
	"application/gzip":             "archive",
	"application/x-tar":            "archive",
}

// extensionToFileType maps file extensions (without dot) to a file type label.
var extensionToFileType = map[string]string{
	"jpg": "image", "jpeg": "image", "png": "image", "gif": "image", "webp": "image",
	"bmp": "image", "tiff": "image", "tif": "image", "svg": "image", "ico": "image",
	"heic": "image", "heif": "image",
	"mp4": "video", "mov": "video", "m4v": "video", "avi": "video", "mkv": "video",
	"webm": "video", "flv": "video", "wmv": "video",
	"mp3": "audio", "wav": "audio", "aac": "audio", "m4a": "audio", "flac": "audio",
	"ogg": "audio", "opus": "audio",
	"zip": "archive", "rar": "archive", "7z": "archive", "tar": "archive",
	"gz": "archive", "tgz": "archive", "bz2": "archive", "xz": "archive",
	"pdf": "document", "doc": "document", "docx": "document", "xls": "document",
	"xlsx": "document", "ppt": "document", "pptx": "document",
	"txt": "text", "md": "text", "csv": "text", "log": "text",
	"yaml": "text", "yml": "text", "json": "text", "xml": "text",
}

// detectFileType returns a coarse-grained file type label based on MIME type and/or file extension.
//
// Returned values are stable, low-cardinality strings intended for UI/logic grouping:
//   - image | video | audio | archive | document | text | other
//
// It falls back to extension-only detection when Content-Type is missing or unhelpful.
func detectFileType(contentType, fileExt string) string {
	ct := strings.ToLower(strings.TrimSpace(contentType))
	ext := strings.ToLower(strings.TrimSpace(fileExt))

	if ftype := detectFileTypeByMIME(ct); ftype != "" {
		return ftype
	}
	if ftype, ok := extensionToFileType[ext]; ok {
		return ftype
	}
	return "other"
}

func detectFileTypeByMIME(ct string) string {
	if ct == "" {
		return ""
	}
	switch {
	case strings.HasPrefix(ct, "image/"):
		return "image"
	case strings.HasPrefix(ct, "video/"):
		return "video"
	case strings.HasPrefix(ct, "audio/"):
		return "audio"
	case strings.HasPrefix(ct, "text/"):
		return "text"
	}
	if ftype, ok := mimeTypeToFileType[ct]; ok {
		return ftype
	}
	return ""
}

// DeleteProjectAsset deletes a project asset
// @Router /api/sico/project/asset [DELETE]
// @Tags Project
// @Accept json
// @Produce json
// @Param request query project.DeleteProjectAssetRequest true "Delete project Asset request"
// @Success 200 {object} project.DeleteProjectAssetResponse
func DeleteProjectAsset(ctx *gin.Context) {
	var (
		err error
		req project.DeleteProjectAssetRequest
	)

	err = ctx.ShouldBindQuery(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := projectSVC.Default().DeleteProjectAsset(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// GetProjectAssetList gets the project asset list
// @Router /api/sico/project/assets [GET]
// @Tags Project
// @Accept json
// @Produce json
// @Param request query project.GetProjectAssetListRequest true "Get project AssetList request"
// @Success 200 {object} project.GetProjectAssetListResponse
// @Security BearerAuth
func GetProjectAssetList(ctx *gin.Context) {
	userInfo, ok := middleware.GetUserFromContext(ctx)
	if !ok {
		unauthorizedResponse(ctx, "Authentication required")
		return
	}

	var req project.GetProjectAssetListRequest
	err := ctx.ShouldBindQuery(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	req.Username = userInfo.Name
	if len(req.ProjectId) == 0 {
		invalidParamRequestResponse(ctx, "project_id is required")
		return
	}

	resp, err := projectSVC.Default().GetProjectAssetList(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}
