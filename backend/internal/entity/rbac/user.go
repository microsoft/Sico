package entity

import (
	"sico-backend/internal/transport/http/dto/rbac/common"
)

type User = common.User

type UserFilter struct {
	Alias      string
	Email      string
	Phone      string
	StatusList []int32
}
