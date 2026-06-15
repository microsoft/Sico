package dal

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"gorm.io/datatypes"
)

type jsonMap map[string]any

func decodeJSONMap(payload string, label string) (jsonMap, error) {
	trimmed := strings.TrimSpace(payload)
	if trimmed == "" {
		return nil, fmt.Errorf("%s is required", label)
	}

	decoder := json.NewDecoder(bytes.NewBufferString(trimmed))
	decoder.UseNumber()

	var result map[string]any
	if err := decoder.Decode(&result); err != nil {
		return nil, fmt.Errorf("decode %s: %w", label, err)
	}

	return result, nil
}

func decodeJSONValue[T any](payload string, label string) (T, error) {
	var result T
	trimmed := strings.TrimSpace(payload)
	if trimmed == "" {
		return result, fmt.Errorf("%s is required", label)
	}

	decoder := json.NewDecoder(bytes.NewBufferString(trimmed))
	decoder.UseNumber()
	if err := decoder.Decode(&result); err != nil {
		return result, fmt.Errorf("decode %s: %w", label, err)
	}

	return result, nil
}

// marshalJSON serializes a trusted Go value (map[string]any, struct, etc.) to
// JSON. Failure here would indicate a programming bug (e.g. unsupported type
// such as a channel or function snuck into the payload) rather than a runtime
// condition, so we panic with the offending value rather than silently emitting
// `{}` and corrupting downstream rows. Callers must only pass JSON-safe inputs.
func marshalJSON(value any) datatypes.JSON {
	payload, err := json.Marshal(value)
	if err != nil {
		panic(fmt.Sprintf("taskruntime: marshalJSON failed for %T: %v", value, err))
	}

	return datatypes.JSON(payload)
}

func jsonBytes(payload string) datatypes.JSON {
	return datatypes.JSON([]byte(strings.TrimSpace(payload)))
}

func compactJSON(payload string) string {
	var buf bytes.Buffer
	if err := json.Compact(&buf, []byte(payload)); err != nil {
		return payload
	}

	return buf.String()
}

func getString(m jsonMap, key string) string {
	value, ok := m[key]
	if !ok || value == nil {
		return ""
	}

	if text, ok := value.(string); ok {
		return text
	}

	return fmt.Sprint(value)
}

func getInt(m jsonMap, key string) int {
	return int(getInt64(m, key))
}

func getInt64(m jsonMap, key string) int64 {
	value, ok := m[key]
	if !ok || value == nil {
		return 0
	}

	return anyToInt64(value)
}

func getOptionalInt64(m jsonMap, key string) *int64 {
	value, ok := m[key]
	if !ok || value == nil {
		return nil
	}

	converted := anyToInt64(value)
	return &converted
}

func anyToInt64(value any) int64 {
	switch typed := value.(type) {
	case json.Number:
		converted, _ := typed.Int64()
		return converted
	case float64:
		return int64(typed)
	case int:
		return int64(typed)
	case int64:
		return typed
	case uint64:
		return int64(typed)
	case string:
		converted, _ := strconv.ParseInt(typed, 10, 64)
		return converted
	default:
		return 0
	}
}

func putValue(m jsonMap, key string, value any) {
	m[key] = value
}

func nowMS() int64 {
	return time.Now().UnixMilli()
}
