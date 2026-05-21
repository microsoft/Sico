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

package cron

import (
	"time"

	default_cron "github.com/robfig/cron/v3"
)

type Cron interface {
	Schedule(interval time.Duration, fn func()) (int, error)
	Stop()
}

type cronImpl struct {
	cron *default_cron.Cron
}

func NewCron() Cron {
	c := default_cron.New(default_cron.WithSeconds())
	c.Start()
	return &cronImpl{cron: c}
}

func (c *cronImpl) Schedule(interval time.Duration, fn func()) (int, error) {
	schedule := default_cron.Every(interval)
	job := default_cron.FuncJob(fn)
	id := c.cron.Schedule(schedule, job)
	return int(id), nil
}

func (c *cronImpl) Stop() {
	c.cron.Stop()
}
