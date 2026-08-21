package storage

import (
	"time"
)

type DelOptFn func(option *DelOption)

type DelOption struct {
	PathPrefix *string
}

func WithDelPathPrefix(v string) DelOptFn {
	return func(o *DelOption) {
		o.PathPrefix = &v
	}
}

type GetOptFn func(option *GetOption)

type GetOption struct {
	Expire     *time.Time
	PathPrefix *string
}

func WithExpire(v time.Time) GetOptFn {
	return func(o *GetOption) {
		o.Expire = &v
	}
}

func WithGetPathPrefix(v string) GetOptFn {
	return func(o *GetOption) {
		o.PathPrefix = &v
	}
}

type PutOption struct {
	ContentType        *string
	ContentEncoding    *string
	ContentDisposition *string
	ContentLanguage    *string
	PathPrefix         *string
	Expires            *time.Time
}

type PutOptFn func(option *PutOption)

func WithContentType(v string) PutOptFn {
	return func(o *PutOption) {
		o.ContentType = &v
	}
}

func WithContentEncoding(v string) PutOptFn {
	return func(o *PutOption) {
		o.ContentEncoding = &v
	}
}

func WithContentDisposition(v string) PutOptFn {
	return func(o *PutOption) {
		o.ContentDisposition = &v
	}
}

func WithContentLanguage(v string) PutOptFn {
	return func(o *PutOption) {
		o.ContentLanguage = &v
	}
}

func WithExpires(v time.Time) PutOptFn {
	return func(o *PutOption) {
		o.Expires = &v
	}
}

func WithPutPathPrefix(v string) PutOptFn {
	return func(o *PutOption) {
		o.PathPrefix = &v
	}
}
