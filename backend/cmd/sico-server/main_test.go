package main

import "testing"

func TestShouldRunSeeds(t *testing.T) {
	tests := []struct {
		name   string
		appEnv string
		want   bool
	}{
		{name: "development", appEnv: "development", want: true},
		{name: "development alias", appEnv: "dev", want: true},
		{name: "test", appEnv: "test", want: false},
		{name: "test alias", appEnv: "testing", want: false},
		{name: "production", appEnv: "production", want: false},
		{name: "production alias", appEnv: "prod", want: false},
		{name: "unset", appEnv: "", want: false},
		{name: "unrecognized", appEnv: "staging", want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("APP_ENV", test.appEnv)
			if got := shouldRunSeeds(); got != test.want {
				t.Fatalf("shouldRunSeeds() = %t, want %t", got, test.want)
			}
		})
	}
}
