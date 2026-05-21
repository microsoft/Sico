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

package common

import "github.com/cloudwego/eino/schema"

type DataType string

const (
	DataTypeString  DataType = "string"  // string
	DataTypeInteger DataType = "integer" // int64
	DataTypeNumber  DataType = "number"  // float64
	DataTypeBoolean DataType = "boolean" // bool
	DataTypeTime    DataType = "time"    // time.Time
	DataTypeObject  DataType = "object"  // map[string]any
	DataTypeArray   DataType = "list"    // []any
	DataTypeFile    DataType = "file"    // string (url)
)

func IsValidDataType(dt DataType) bool {
	switch dt {
	case DataTypeString, DataTypeInteger, DataTypeNumber, DataTypeBoolean, DataTypeTime, DataTypeObject, DataTypeArray, DataTypeFile:
		return true
	default:
		return false
	}
}

func HasValidDataType(ti *TypeInfo) bool {
	if ti == nil {
		return false
	}
	if !IsValidDataType(DataType(ti.DataType)) {
		return false
	}
	if ti.DataType == string(DataTypeArray) {
		return HasValidDataType(ti.ElemType)
	} else if ti.DataType == string(DataTypeObject) {
		for _, field := range ti.Properties {
			if !HasValidDataType(field) {
				return false
			}
		}
	}
	return true
}

func HasValidDataTypeWithName(ti *NamedTypeInfo) bool {
	if ti == nil {
		return false
	}
	return HasValidDataType(ti.Type)
}

func convertDataTypeToSchemaDataType(d DataType) schema.DataType {
	switch d {
	case DataTypeString, DataTypeTime, DataTypeFile:
		return schema.String
	case DataTypeNumber:
		return schema.Number
	case DataTypeInteger:
		return schema.Integer
	case DataTypeBoolean:
		return schema.Boolean
	case DataTypeObject:
		return schema.Object
	case DataTypeArray:
		return schema.Array
	default:
		panic("unknown data type")
	}
}

func (n *TypeInfo) ToParameterInfo() (*schema.ParameterInfo, error) {
	param := &schema.ParameterInfo{
		Type:     convertDataTypeToSchemaDataType(DataType(n.DataType)),
		Desc:     n.Description,
		Required: n.Required,
	}

	if DataType(n.DataType) == DataTypeObject {
		param.SubParams = make(map[string]*schema.ParameterInfo, len(n.Properties))
		for name, subT := range n.Properties {
			subParam, err := subT.ToParameterInfo()
			if err != nil {
				return nil, err
			}
			param.SubParams[name] = subParam
		}
	} else if DataType(n.DataType) == DataTypeArray {
		elemParam, err := n.ElemType.ToParameterInfo()
		if err != nil {
			return nil, err
		}
		param.ElemInfo = elemParam
	}

	return param, nil
}
