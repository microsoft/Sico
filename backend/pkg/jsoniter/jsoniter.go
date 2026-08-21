package jsoniter

import jsoniter "github.com/json-iterator/go"

var config = jsoniter.Config{
	UseNumber:             true,
	DisallowUnknownFields: false,
}.Froze()

func SortMapKeysConfig() jsoniter.Config {
	return jsoniter.Config{
		UseNumber:             true,
		DisallowUnknownFields: false,
		SortMapKeys:           true,
	}
}

// Marshal returns the JSON encoding bytes of v.
func Marshal(val interface{}) ([]byte, error) {
	return config.Marshal(val)
}

// MarshalIndent is like Marshal but applies Indent to format the output.
// Each JSON element in the output will begin on a new line beginning with prefix
// followed by one or more copies of indent according to the indentation nesting.
func MarshalIndent(v interface{}, prefix, indent string) ([]byte, error) {
	return config.MarshalIndent(v, prefix, indent)
}

// MarshalString returns the JSON encoding string of v.
func MarshalString(val interface{}) (string, error) {
	return config.MarshalToString(val)
}

// Unmarshal parses the JSON-encoded data and stores the result in the value pointed to by v.
// NOTICE: This API copies given buffer by default,
// if you want to pass JSON more efficiently, use UnmarshalString instead.
func Unmarshal(buf []byte, val interface{}) error {
	return config.Unmarshal(buf, val)
}

// UnmarshalString is like Unmarshal, except buf is a string.
func UnmarshalString(buf string, val interface{}) error {
	return config.UnmarshalFromString(buf, val)
}

func Get(src []byte, path ...interface{}) (jsoniter.Any, error) {
	v := jsoniter.Get(src, path...)
	err := v.LastError()
	return v, err
}
