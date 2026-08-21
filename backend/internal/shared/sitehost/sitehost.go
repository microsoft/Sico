package sitehost

import "strings"

func Normalize(raw string) string {
	host := strings.TrimSpace(raw)
	if host == "" {
		return ""
	}
	if index := strings.Index(host, "://"); index >= 0 {
		host = host[index+3:]
	}
	if index := strings.IndexAny(host, "/?#"); index >= 0 {
		host = host[:index]
	}
	if index := strings.LastIndex(host, "@"); index >= 0 {
		host = host[index+1:]
	}
	if index := strings.LastIndex(host, ":"); index >= 0 {
		host = host[:index]
	}

	return strings.TrimSuffix(strings.ToLower(host), ".")
}
