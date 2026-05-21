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

package response

import "reflect"

const (
	DefaultSuccessCode int32 = 0
	DefaultSuccessMsg        = "success"
)

func Success[T any](resp T) T {
	apply(resp, DefaultSuccessCode, DefaultSuccessMsg)
	return resp
}

func apply(resp any, code int32, msg string) {
	v := reflect.ValueOf(resp)
	if v.Kind() != reflect.Pointer || v.IsNil() {
		return
	}
	e := v.Elem()

	if f := e.FieldByName("Code"); f.IsValid() && f.CanSet() {
		switch f.Kind() {
		case reflect.Int, reflect.Int32, reflect.Int64:
			f.SetInt(int64(code))
		}
	}
	if f := e.FieldByName("Msg"); f.IsValid() && f.CanSet() && f.Kind() == reflect.String {
		f.SetString(msg)
	}
}
