package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	notificationbiz "sico-backend/internal/biz/notification"
	"sico-backend/internal/transport/http/dto/notification"
)

// CreateNotification .
// @Router /api/sico/notification [POST]
// @Tags Notification
// @Accept json
// @Produce json
// @Param request body notification.CreateNotificationRequest true "Create Notification Request"
// @Success 200 {object} notification.CreateNotificationResponse
// @Security BearerAuth
func CreateNotification(ctx *gin.Context) {
	var (
		err error
		req notification.CreateNotificationRequest
	)

	err = ctx.ShouldBindJSON(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := notificationbiz.Default().CreateNotification(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// UpdateNotificationStatus .
// @Router /api/sico/notification/status [PUT]
// @Tags Notification
// @Accept json
// @Produce json
// @Param request body notification.UpdateNotificationStatusRequest true "Update Notification Status Request"
// @Success 200 {object} notification.UpdateNotificationStatusResponse
// @Security BearerAuth
func UpdateNotificationStatus(ctx *gin.Context) {
	var (
		err error
		req notification.UpdateNotificationStatusRequest
	)

	err = ctx.ShouldBindJSON(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := notificationbiz.Default().UpdateNotificationStatus(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// ListNotification .
// @Router /api/sico/notifications [GET]
// @Tags Notification
// @Produce json
// @Param request query notification.ListNotificationRequest true "List Notification Request"
// @Success 200 {object} notification.ListNotificationResponse
// @Security BearerAuth
func ListNotification(ctx *gin.Context) {
	var (
		err error
		req notification.ListNotificationRequest
	)

	err = ctx.ShouldBindQuery(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := notificationbiz.Default().ListNotification(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// ListProjectNotifications lists notifications for a specific project.
// @Router /api/sico/project/notifications [GET]
// @Tags Notification
// @Produce json
// @Param request query notification.ListProjectNotificationsRequest true "List Project Notifications Request"
// @Success 200 {object} notification.ListProjectNotificationsResponse
// @Security BearerAuth
func ListProjectNotifications(ctx *gin.Context) {
	var (
		err error
		req notification.ListProjectNotificationsRequest
	)

	err = ctx.ShouldBindQuery(&req)
	if err != nil {
		invalidParamRequestResponse(ctx, err.Error())
		return
	}

	resp, err := notificationbiz.Default().ListProjectNotifications(reqctx(ctx), &req)
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

// ReadAllNotifications marks all notifications for the current user as read.
// @Router /api/sico/notification/read-all [PUT]
// @Tags Notification
// @Produce json
// @Success 200 {object} notification.ReadAllNotificationsResponse
// @Security BearerAuth
func ReadAllNotifications(ctx *gin.Context) {
	resp, err := notificationbiz.Default().ReadAllNotifications(reqctx(ctx))
	if err != nil {
		internalServerErrorResponse(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, resp)
}
