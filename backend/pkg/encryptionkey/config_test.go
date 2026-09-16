package encryptionkey

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestSharedEncryptionKeyConfiguration(t *testing.T) {
	key := []byte(strings.Repeat("k", 32))
	for _, test := range []struct {
		name, value string
		wantErr     bool
	}{
		{"absent", "", false},
		{"padded", base64.StdEncoding.EncodeToString(key), false},
		{"raw", base64.RawStdEncoding.EncodeToString(key), false},
		{"whitespace", " " + base64.StdEncoding.EncodeToString(key) + " ", false},
		{"invalid", "invalid-secret", true},
		{"wrong length", base64.StdEncoding.EncodeToString(key[:16]), true},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv(EnvironmentVariable, test.value)
			got, err := FromEnvironment()
			if test.wantErr {
				if err == nil || strings.Contains(err.Error(), test.value) {
					t.Fatal("invalid key must fail without exposing its value")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if test.name == "absent" {
				if got != nil {
					t.Fatal("absent key must remain unconfigured")
				}
			} else if string(got) != string(key) {
				t.Fatal("key bytes changed")
			}
		})
	}
}
