// Copyright (c) 2026 Sico Authors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

package logutil

import (
	"sort"
	"unicode/utf8"
)

// Abbrev returns a best-effort abbreviated string for logging.
// It is UTF-8 safe and appends "...(truncated)" when shortened.
func Abbrev(s string, maxRunes int) string {
	if maxRunes <= 0 {
		return ""
	}
	if s == "" {
		return ""
	}
	if utf8.RuneCountInString(s) <= maxRunes {
		return s
	}

	out := make([]rune, 0, maxRunes)
	for _, r := range s {
		out = append(out, r)
		if len(out) >= maxRunes {
			break
		}
	}

	return string(out) + "...(truncated)"
}

// SortedKeys returns sorted keys of a map for stable logging.
func SortedKeys(m map[string]string) []string {
	if len(m) == 0 {
		return nil
	}

	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	return keys
}

// SortedAnyKeys returns sorted keys of a map[string]any for stable logging.
func SortedAnyKeys(m map[string]any) []string {
	if len(m) == 0 {
		return nil
	}

	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	return keys
}

// SortedKeysLimit returns at most limit keys, sorted.
func SortedKeysLimit(m map[string]string, limit int) []string {
	keys := SortedKeys(m)
	if limit <= 0 || len(keys) <= limit {
		return keys
	}

	return keys[:limit]
}

// SortedAnyKeysLimit returns at most limit keys from map[string]any, sorted.
func SortedAnyKeysLimit(m map[string]any, limit int) []string {
	keys := SortedAnyKeys(m)
	if limit <= 0 || len(keys) <= limit {
		return keys
	}

	return keys[:limit]
}
