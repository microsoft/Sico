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
