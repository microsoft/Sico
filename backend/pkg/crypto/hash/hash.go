// Package hash provides password hashing helpers built on top of bcrypt.
package hash

import "golang.org/x/crypto/bcrypt"

// GeneratePassword hashes the given password using bcrypt with the default cost.
func GeneratePassword(password string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// CompareHashAndPassword reports whether hashedPassword matches password.
// It returns nil on success and a non-nil error on mismatch.
func CompareHashAndPassword(hashedPassword, password string) error {
	return bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(password))
}
