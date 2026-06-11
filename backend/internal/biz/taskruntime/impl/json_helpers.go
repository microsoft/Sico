// Copyright (c) 2026 Sico Authors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

package impl

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
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

func getUint64(m jsonMap, key string) uint64 {
	value := getInt64(m, key)
	if value < 0 {
		return 0
	}
	return uint64(value)
}

func getOptionalInt64(m jsonMap, key string) *int64 {
	value, ok := m[key]
	if !ok || value == nil {
		return nil
	}
	converted := anyToInt64(value)
	return &converted
}

func getOptionalUint64(m jsonMap, key string) *uint64 {
	value, ok := m[key]
	if !ok || value == nil {
		return nil
	}
	converted := anyToInt64(value)
	if converted < 0 {
		converted = 0
	}
	result := uint64(converted)
	return &result
}

func getMap(m jsonMap, key string) jsonMap {
	value, ok := m[key]
	if !ok || value == nil {
		return nil
	}
	if result, ok := value.(map[string]any); ok {
		return result
	}
	return nil
}

func getArray(m jsonMap, key string) []any {
	value, ok := m[key]
	if !ok || value == nil {
		return nil
	}
	if result, ok := value.([]any); ok {
		return result
	}
	return nil
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

func nowMS() uint64 {
	return uint64(time.Now().UnixMilli())
}

func newID(prefix string) string {
	return prefix + "-" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
}
