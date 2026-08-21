package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestWriteOrCheckGeneratedFile(t *testing.T) {
	filePath := filepath.Join(t.TempDir(), generatedFileName)
	generated := []byte("generated output\n")

	require.NoError(t, writeOrCheckGeneratedFile(filePath, generated, config{write: true}))
	require.NoError(t, writeOrCheckGeneratedFile(filePath, generated, config{check: true}))

	require.NoError(t, os.WriteFile(filePath, []byte("stale output\n"), 0o644))
	require.ErrorContains(t, writeOrCheckGeneratedFile(filePath, generated, config{check: true}), "is stale")

	require.NoError(t, os.Remove(filePath))
	require.ErrorContains(t, writeOrCheckGeneratedFile(filePath, generated, config{check: true}), "is missing")
}
