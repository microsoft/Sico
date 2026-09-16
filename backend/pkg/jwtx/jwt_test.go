package jwtx

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestDefaultTokenExpirationIsSevenDays(t *testing.T) {
	before := time.Now().Add(defaultTokenExpiration).Unix()
	tokenInfo, err := New(nil).GenerateToken(context.Background(), &UserInfo{Name: "test@example.com"})
	after := time.Now().Add(defaultTokenExpiration).Unix()

	require.NoError(t, err)
	require.GreaterOrEqual(t, tokenInfo.GetExpiresAt(), before)
	require.LessOrEqual(t, tokenInfo.GetExpiresAt(), after)
}
