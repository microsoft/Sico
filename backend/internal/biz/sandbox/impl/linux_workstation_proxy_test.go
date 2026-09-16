package impl

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestProxyLinuxWorkstationHTTPPreservesBinaryResponseBody(t *testing.T) {
	want := []byte{0x89, 0x50, 0x4e, 0x47, 0x00, 0xff}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "image/png")
		_, err := writer.Write(want)
		require.NoError(t, err)
	}))
	t.Cleanup(server.Close)

	statusCode, contentType, body, err := proxyLinuxWorkstationHTTP(
		context.Background(),
		http.MethodGet,
		server.URL,
		"",
		nil,
	)

	require.NoError(t, err)
	require.Equal(t, http.StatusOK, statusCode)
	require.Equal(t, "image/png", contentType)
	require.Equal(t, want, body)
}

func TestExtractLinuxWorkstationProxyRIDAcceptsCanonicalPaths(t *testing.T) {
	tests := []struct {
		name string
		path string
		want string
	}{
		{name: "canonical", path: "/api/sico/sandbox/resources/linux_workstation/canonical-id/", want: "canonical-id"},
		{
			name: "canonical nested",
			path: "/api/sico/sandbox/resources/linux_workstation/canonical-id/v1/shell/exec",
			want: "canonical-id",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			rid, err := extractLinuxWorkstationProxyRID(test.path)
			require.NoError(t, err)
			require.Equal(t, test.want, rid)
			require.Equal(t, test.want, extractRIDFromLinuxWorkstationEndpoint(test.path))
		})
	}
}

func TestExtractLinuxWorkstationProxyRIDRejectsInvalidPaths(t *testing.T) {
	_, err := extractLinuxWorkstationProxyRID("/api/sico/sandbox/resources/emulator/device-id/")
	require.ErrorContains(t, err, "must be a Linux Workstation resource proxy path")

	_, err = extractLinuxWorkstationProxyRID("/api/sico/sandbox/resources/linux_workstation/")
	require.ErrorContains(t, err, "must include Linux Workstation resource id")
}
