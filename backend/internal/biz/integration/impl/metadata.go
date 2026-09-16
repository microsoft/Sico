package impl

import (
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/structpb"
	"gorm.io/datatypes"
)

func unmarshalMetadata(data datatypes.JSON) (*structpb.Struct, error) {
	if len(data) == 0 || string(data) == "null" {
		return nil, nil
	}
	metadata := &structpb.Struct{}
	if err := protojson.Unmarshal(data, metadata); err != nil {
		return nil, err
	}
	return metadata, nil
}
