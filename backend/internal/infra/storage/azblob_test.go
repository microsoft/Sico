package storage

import (
	"context"
	"testing"
)

func TestAzureBlobGetObjectURLByPathUsesConfiguredCDN(t *testing.T) {
	client := &azureBlobClient{
		cdnEndpoint: "https://cdn.example/",
		container:   "test",
	}

	got, err := client.GetObjectUrlByPath(context.Background(), "default_space/7670487904363216896.zip")
	if err != nil {
		t.Fatalf("GetObjectUrlByPath returned an error: %v", err)
	}
	const want = "https://cdn.example/test/default_space/7670487904363216896.zip"
	if got != want {
		t.Fatalf("expected CDN url %q, got %q", want, got)
	}
}
