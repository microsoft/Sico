package enum

import (
	"reflect"
	"testing"
)

func TestAllAgentRoles(t *testing.T) {
	want := []string{
		"Assistant",
		"Android Tester",
		"3D Artist",
		"Product Manager",
		"Marketing",
	}
	if got := AllAgentRoles(); !reflect.DeepEqual(got, want) {
		t.Fatalf("AllAgentRoles() = %#v, want %#v", got, want)
	}
}
