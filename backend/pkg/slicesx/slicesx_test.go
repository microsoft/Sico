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

package slicesx

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestTransform(t *testing.T) {
	t.Run("int to string", func(t *testing.T) {
		input := []int{1, 2, 3}
		result := Transform(input, func(i int) string {
			return string(rune('a' + i - 1))
		})
		assert.Equal(t, []string{"a", "b", "c"}, result)
	})

	t.Run("empty input", func(t *testing.T) {
		result := Transform([]int{}, func(i int) int { return i * 2 })
		assert.Empty(t, result)
	})

	t.Run("nil input", func(t *testing.T) {
		result := Transform[int, int](nil, func(i int) int { return i })
		assert.Empty(t, result)
	})
}

func TestUnique(t *testing.T) {
	t.Run("removes duplicates", func(t *testing.T) {
		result := Unique([]int{1, 2, 2, 3, 1})
		assert.ElementsMatch(t, []int{1, 2, 3}, result)
	})

	t.Run("empty", func(t *testing.T) {
		result := Unique([]string{})
		assert.Empty(t, result)
	})
}

func TestChunks(t *testing.T) {
	t.Run("even split", func(t *testing.T) {
		result := Chunks([]int{1, 2, 3, 4}, 2)
		assert.Len(t, result, 2)
		assert.Equal(t, []int{1, 2}, result[0])
		assert.Equal(t, []int{3, 4}, result[1])
	})

	t.Run("uneven split", func(t *testing.T) {
		result := Chunks([]int{1, 2, 3}, 2)
		assert.Len(t, result, 2)
		assert.Equal(t, []int{3}, result[1])
	})

	t.Run("chunk size larger than slice", func(t *testing.T) {
		result := Chunks([]int{1}, 10)
		assert.Len(t, result, 1)
	})

	t.Run("empty", func(t *testing.T) {
		result := Chunks([]int{}, 5)
		assert.Empty(t, result)
	})
}

func TestToMap(t *testing.T) {
	type item struct {
		ID   int
		Name string
	}

	items := []item{{1, "a"}, {2, "b"}}
	result := ToMap(items, func(e item) (int, string) { return e.ID, e.Name })
	assert.Equal(t, "a", result[1])
	assert.Equal(t, "b", result[2])
}

func TestGroupBy(t *testing.T) {
	type item struct {
		Category string
		Value    int
	}

	items := []item{{"a", 1}, {"b", 2}, {"a", 3}}
	result := GroupBy(items, func(i item) (string, int) { return i.Category, i.Value })
	assert.Equal(t, []int{1, 3}, result["a"])
	assert.Equal(t, []int{2}, result["b"])
}

func TestFill(t *testing.T) {
	result := Fill(0, 3)
	assert.Equal(t, []int{0, 0, 0}, result)
}

func TestReverse(t *testing.T) {
	result := Reverse([]int{1, 2, 3})
	assert.Equal(t, []int{3, 2, 1}, result)
}
