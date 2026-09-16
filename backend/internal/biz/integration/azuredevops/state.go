package azuredevops

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"

	"sico-backend/internal/biz/integration/connector"
)

const oauthStateNamespace = "sico:integration:oauth-state:"

var ErrOAuthStateInvalid = errors.New("OAuth state is invalid, expired, or already consumed")

type OAuthState = connector.OAuthState

type StateStore interface {
	Create(ctx context.Context, state *OAuthState) (string, error)
	Consume(ctx context.Context, stateID string) (*OAuthState, error)
}

type protectedState struct {
	Scheme string `json:"scheme"`
	KeyID  string `json:"keyId"`
	Data   string `json:"data"`
}

type redisStateStore struct {
	client *redis.Client
	cipher Cipher
	ttl    time.Duration
}

func NewRedisStateStore(client *redis.Client, cipher Cipher, ttl time.Duration) (StateStore, error) {
	if client == nil {
		return nil, errors.New("redis is required for Azure DevOps OAuth state")
	}
	if cipher == nil {
		return nil, errors.New("cipher is required for Azure DevOps OAuth state")
	}
	if ttl <= 0 {
		return nil, errors.New("OAuth state TTL must be positive")
	}
	return &redisStateStore{client: client, cipher: cipher, ttl: ttl}, nil
}

func (s *redisStateStore) Create(ctx context.Context, state *OAuthState) (string, error) {
	stateID, err := randomURLToken(32)
	if err != nil {
		return "", err
	}
	value, err := protectOAuthState(s.cipher, stateID, state, s.ttl)
	if err != nil {
		return "", err
	}
	created, err := s.client.SetArgs(ctx, oauthStateNamespace+stateID, value, redis.SetArgs{
		Mode: "NX",
		TTL:  s.ttl,
	}).Result()
	if errors.Is(err, redis.Nil) {
		return "", errors.New("OAuth state collision")
	}
	if err != nil {
		return "", fmt.Errorf("store OAuth state: %w", err)
	}
	if created != "OK" {
		return "", errors.New("OAuth state collision")
	}
	return stateID, nil
}

func (s *redisStateStore) Consume(ctx context.Context, stateID string) (*OAuthState, error) {
	value, err := s.client.GetDel(ctx, oauthStateNamespace+stateID).Result()
	if errors.Is(err, redis.Nil) {
		return nil, ErrOAuthStateInvalid
	}
	if err != nil {
		return nil, fmt.Errorf("consume OAuth state: %w", err)
	}
	return unprotectOAuthState(s.cipher, stateID, value)
}

type memoryStateStore struct {
	mu     sync.Mutex
	cipher Cipher
	ttl    time.Duration
	values map[string]string
}

func NewMemoryStateStore(cipher Cipher, ttl time.Duration) StateStore {
	return &memoryStateStore{cipher: cipher, ttl: ttl, values: make(map[string]string)}
}

func (s *memoryStateStore) Create(_ context.Context, state *OAuthState) (string, error) {
	stateID, err := randomURLToken(32)
	if err != nil {
		return "", err
	}
	value, err := protectOAuthState(s.cipher, stateID, state, s.ttl)
	if err != nil {
		return "", err
	}
	s.mu.Lock()
	s.values[stateID] = value
	s.mu.Unlock()
	return stateID, nil
}

func (s *memoryStateStore) Consume(_ context.Context, stateID string) (*OAuthState, error) {
	s.mu.Lock()
	value, ok := s.values[stateID]
	delete(s.values, stateID)
	s.mu.Unlock()
	if !ok {
		return nil, ErrOAuthStateInvalid
	}
	return unprotectOAuthState(s.cipher, stateID, value)
}

func protectOAuthState(cipher Cipher, stateID string, state *OAuthState, ttl time.Duration) (string, error) {
	now := time.Now()
	if state.CreatedAt == 0 {
		state.CreatedAt = now.UnixMilli()
	}
	if state.ExpiresAt == 0 {
		state.ExpiresAt = now.Add(ttl).UnixMilli()
	}
	plaintext, err := json.Marshal(state)
	if err != nil {
		return "", fmt.Errorf("marshal OAuth state: %w", err)
	}
	encrypted, err := cipher.Encrypt(plaintext, []byte(oauthStateNamespace+stateID))
	if err != nil {
		return "", err
	}
	value, err := json.Marshal(&protectedState{
		Scheme: encrypted.Scheme,
		KeyID:  encrypted.KeyID,
		Data:   base64.RawStdEncoding.EncodeToString(encrypted.Data),
	})
	if err != nil {
		return "", fmt.Errorf("marshal protected OAuth state: %w", err)
	}
	return string(value), nil
}

func unprotectOAuthState(cipher Cipher, stateID, value string) (*OAuthState, error) {
	var protected protectedState
	if err := json.Unmarshal([]byte(value), &protected); err != nil {
		return nil, ErrOAuthStateInvalid
	}
	data, err := base64.RawStdEncoding.DecodeString(protected.Data)
	if err != nil {
		return nil, ErrOAuthStateInvalid
	}
	plaintext, err := cipher.Decrypt(&EncryptedData{
		Scheme: protected.Scheme,
		KeyID:  protected.KeyID,
		Data:   data,
	}, []byte(oauthStateNamespace+stateID))
	if err != nil {
		return nil, ErrOAuthStateInvalid
	}
	var state OAuthState
	if err := json.Unmarshal(plaintext, &state); err != nil || state.ExpiresAt <= time.Now().UnixMilli() {
		return nil, ErrOAuthStateInvalid
	}
	return &state, nil
}
