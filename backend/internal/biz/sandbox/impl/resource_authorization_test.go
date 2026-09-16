package impl

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"sico-backend/internal/errcode"
	"sico-backend/internal/shared/apperr"
)

func TestGetInstanceByStringIDErrorClassification(t *testing.T) {
	tests := []struct {
		name       string
		instanceID string
		repo       *dashboardInstanceRepo
		wantCode   int32
		wantErr    error
	}{
		{name: "empty ID", instanceID: " ", wantCode: errcode.CommonInvalidParam},
		{name: "malformed ID", instanceID: "abc", wantCode: errcode.CommonInvalidParam},
		{name: "non-positive ID", instanceID: "0", wantCode: errcode.CommonInvalidParam},
		{name: "repository unavailable", instanceID: "1", wantCode: errcode.CommonUnavailable},
		{name: "missing instance", instanceID: "1", repo: &dashboardInstanceRepo{}, wantCode: errcode.CommonNotFound},
		{
			name: "repository error", instanceID: "1",
			repo: &dashboardInstanceRepo{err: context.DeadlineExceeded}, wantErr: context.DeadlineExceeded,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			service := &Service{}
			if test.repo != nil {
				service.InstanceRepo = test.repo
			}
			_, err := service.getInstanceByStringID(context.Background(), test.instanceID)
			if test.wantErr != nil {
				require.True(t, errors.Is(err, test.wantErr))
				return
			}
			appError, ok := apperr.As(err)
			require.True(t, ok)
			require.Equal(t, test.wantCode, appError.Code())
		})
	}
}

func TestGetProjectErrorClassification(t *testing.T) {
	_, err := (&Service{}).getProject(context.Background(), 1)
	appError, ok := apperr.As(err)
	require.True(t, ok)
	require.Equal(t, errcode.CommonUnavailable, appError.Code())

	_, err = (&Service{}).getProject(context.Background(), 0)
	appError, ok = apperr.As(err)
	require.True(t, ok)
	require.Equal(t, errcode.CommonForbidden, appError.Code())

	service := &Service{ProjectRepo: &dashboardProjectRepo{err: gorm.ErrRecordNotFound}}
	_, err = service.getProject(context.Background(), 1)
	appError, ok = apperr.As(err)
	require.True(t, ok)
	require.Equal(t, errcode.CommonNotFound, appError.Code())
}
