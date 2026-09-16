package azuredevops

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"

	"sico-backend/internal/biz/integration/connector"
)

const (
	encryptionScheme = "envelope-aes-256-gcm-v1"
	credentialKeyID  = "integration-key-v1"
)

var ErrDecryptCredential = errors.New("decrypt integration credential")

type EncryptedData = connector.EncryptedData

type Cipher interface {
	Encrypt(plaintext, additionalData []byte) (*EncryptedData, error)
	Decrypt(encrypted *EncryptedData, additionalData []byte) ([]byte, error)
}

type AESGCMCipher struct {
	root  cipher.AEAD
	keyID string
}

type envelopeV1 struct {
	Version         int    `json:"version"`
	WrappedDEK      string `json:"wrappedDek"`
	WrappedDEKNonce string `json:"wrappedDekNonce"`
	Ciphertext      string `json:"ciphertext"`
	CiphertextNonce string `json:"ciphertextNonce"`
}

func NewAESGCMCipher(encodedKey, keyID string) (*AESGCMCipher, error) {
	key, err := decodeEncryptionKey(encodedKey)
	if err != nil {
		return nil, err
	}
	if keyID == "" {
		return nil, errors.New("integration credential key ID is required")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("create integration credential cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create integration credential AEAD: %w", err)
	}
	return &AESGCMCipher{root: aead, keyID: keyID}, nil
}

func (c *AESGCMCipher) Encrypt(plaintext, additionalData []byte) (*EncryptedData, error) {
	dek := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, dek); err != nil {
		return nil, fmt.Errorf("generate integration credential DEK: %w", err)
	}
	block, err := aes.NewCipher(dek)
	if err != nil {
		return nil, fmt.Errorf("create integration credential data cipher: %w", err)
	}
	dataAEAD, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create integration credential data AEAD: %w", err)
	}
	dataNonce := make([]byte, dataAEAD.NonceSize())
	if _, err := io.ReadFull(rand.Reader, dataNonce); err != nil {
		return nil, fmt.Errorf("generate integration credential nonce: %w", err)
	}
	wrapNonce := make([]byte, c.root.NonceSize())
	if _, err := io.ReadFull(rand.Reader, wrapNonce); err != nil {
		return nil, fmt.Errorf("generate integration credential wrap nonce: %w", err)
	}
	envelope := envelopeV1{
		Version:         1,
		WrappedDEK:      base64.RawStdEncoding.EncodeToString(c.root.Seal(nil, wrapNonce, dek, wrapAAD(additionalData))),
		WrappedDEKNonce: base64.RawStdEncoding.EncodeToString(wrapNonce),
		Ciphertext:      base64.RawStdEncoding.EncodeToString(dataAEAD.Seal(nil, dataNonce, plaintext, additionalData)),
		CiphertextNonce: base64.RawStdEncoding.EncodeToString(dataNonce),
	}
	data, err := json.Marshal(&envelope)
	if err != nil {
		return nil, fmt.Errorf("marshal integration credential envelope: %w", err)
	}
	return &EncryptedData{Scheme: encryptionScheme, KeyID: c.keyID, Data: data}, nil
}

func (c *AESGCMCipher) Decrypt(encrypted *EncryptedData, additionalData []byte) ([]byte, error) {
	if encrypted == nil || encrypted.Scheme != encryptionScheme || encrypted.KeyID != c.keyID {
		return nil, ErrDecryptCredential
	}
	envelope, err := decodeEnvelope(encrypted.Data)
	if err != nil {
		return nil, ErrDecryptCredential
	}
	dek, err := unwrapDEK(c.root, envelope, additionalData)
	if err != nil {
		return nil, ErrDecryptCredential
	}
	return decryptEnvelopePayload(envelope, dek, additionalData)
}

func decodeEnvelope(data []byte) (*envelopeV1, error) {
	var envelope envelopeV1
	if err := json.Unmarshal(data, &envelope); err != nil || envelope.Version != 1 {
		return nil, ErrDecryptCredential
	}
	return &envelope, nil
}

func unwrapDEK(root cipher.AEAD, envelope *envelopeV1, additionalData []byte) ([]byte, error) {
	wrappedDEK, err := base64.RawStdEncoding.DecodeString(envelope.WrappedDEK)
	if err != nil {
		return nil, ErrDecryptCredential
	}
	nonce, err := base64.RawStdEncoding.DecodeString(envelope.WrappedDEKNonce)
	if err != nil || len(nonce) != root.NonceSize() {
		return nil, ErrDecryptCredential
	}
	dek, err := root.Open(nil, nonce, wrappedDEK, wrapAAD(additionalData))
	if err != nil || len(dek) != 32 {
		return nil, ErrDecryptCredential
	}
	return dek, nil
}

func decryptEnvelopePayload(envelope *envelopeV1, dek, additionalData []byte) ([]byte, error) {
	block, err := aes.NewCipher(dek)
	if err != nil {
		return nil, ErrDecryptCredential
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, ErrDecryptCredential
	}
	nonce, err := base64.RawStdEncoding.DecodeString(envelope.CiphertextNonce)
	if err != nil || len(nonce) != aead.NonceSize() {
		return nil, ErrDecryptCredential
	}
	ciphertext, err := base64.RawStdEncoding.DecodeString(envelope.Ciphertext)
	if err != nil {
		return nil, ErrDecryptCredential
	}
	plaintext, err := aead.Open(nil, nonce, ciphertext, additionalData)
	if err != nil {
		return nil, ErrDecryptCredential
	}
	return plaintext, nil
}

func wrapAAD(additionalData []byte) []byte {
	result := make([]byte, 0, len(additionalData)+19)
	result = append(result, "integration-dek:v1:"...)
	result = append(result, additionalData...)
	return result
}

func CredentialAAD(connectionID, version int64, provider string, mode int32) []byte {
	return []byte(
		"integration-credential:v1:" + strconv.FormatInt(connectionID, 10) + ":" +
			strconv.FormatInt(version, 10) + ":" + provider + ":" + strconv.FormatInt(int64(mode), 10),
	)
}

func decodeEncryptionKey(encodedKey string) ([]byte, error) {
	key, err := base64.StdEncoding.DecodeString(encodedKey)
	if err != nil {
		key, err = base64.RawStdEncoding.DecodeString(encodedKey)
	}
	if err != nil || len(key) != 32 {
		return nil, errors.New("integration credential key must be a base64-encoded 32-byte value")
	}
	return key, nil
}
