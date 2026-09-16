// Package encryptionkey loads SICO's per-environment data-encryption key.
package encryptionkey

import (
	"encoding/base64"
	"fmt"
	"os"
	"strings"
)

const EnvironmentVariable = "SICO_ENCRYPTION_KEY"

// FromEnvironment reads the canonical key. An absent configuration returns nil;
// callers decide whether the feature requires a key.
func FromEnvironment() ([]byte, error) {
	value := strings.TrimSpace(os.Getenv(EnvironmentVariable))
	if value == "" {
		return nil, nil
	}
	key, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		key, err = base64.RawStdEncoding.DecodeString(value)
	}
	if err != nil || len(key) != 32 {
		return nil, fmt.Errorf("%s must be a base64-encoded 32-byte encryption key", EnvironmentVariable)
	}
	return key, nil
}
