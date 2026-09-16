package azuredevops

import (
	"encoding/base64"
	"encoding/json"
	"strings"

	"github.com/google/uuid"
)

// JWTUUIDClaim extracts an identifier from a token returned by the configured
// Entra endpoint. It validates claim shape only; it is not a JWT verifier.
func JWTUUIDClaim(token, name string) string {
	parts := strings.Split(token, ".")
	if len(parts) < 2 {
		return ""
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return ""
	}
	var claims map[string]any
	if err := json.Unmarshal(payload, &claims); err != nil {
		return ""
	}
	value, _ := claims[name].(string)
	if _, err := uuid.Parse(value); err != nil {
		return ""
	}
	return value
}
