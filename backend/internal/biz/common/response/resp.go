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
