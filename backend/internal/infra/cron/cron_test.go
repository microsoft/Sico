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
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestParserNextUsesConfiguredTimezone(t *testing.T) {
	schedule, err := NewParser().Parse("0 8 * * *", "America/New_York")
	require.NoError(t, err)

	after := time.Date(2026, time.March, 8, 11, 0, 0, 0, time.UTC)
	next := schedule.Next(after)

	require.Equal(t, time.Date(2026, time.March, 8, 12, 0, 0, 0, time.UTC), next)
}

func TestParserRejectsInvalidInput(t *testing.T) {
	parser := NewParser()

	_, err := parser.Parse("", "UTC")
	require.ErrorContains(t, err, "expression")

	_, err = parser.Parse("0 8 * * *", "Not/A_Timezone")
	require.ErrorContains(t, err, "timezone")

	_, err = parser.Parse("not a cron", "UTC")
	require.ErrorContains(t, err, "parse cron expression")
}

func TestCronEveryRunsAndStops(t *testing.T) {
	runner := NewCron()
	runner.Start()

	run := make(chan struct{}, 1)
	_, err := runner.Every(time.Second, func(context.Context) error {
		select {
		case run <- struct{}{}:
		default:
		}
		return nil
	})
	require.NoError(t, err)

	select {
	case <-run:
	case <-time.After(2 * time.Second):
		t.Fatal("cron job did not run")
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	require.NoError(t, runner.Stop(ctx))
}

func TestCronEverySkipsOverlappingRuns(t *testing.T) {
	runner := NewCron()
	runner.Start()

	started := make(chan struct{})
	release := make(chan struct{})
	var runs atomic.Int32
	_, err := runner.Every(time.Second, func(context.Context) error {
		if runs.Add(1) == 1 {
			close(started)
		}
		<-release
		return nil
	})
	require.NoError(t, err)

	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("cron job did not start")
	}
	time.Sleep(1100 * time.Millisecond)
	require.Equal(t, int32(1), runs.Load())
	close(release)

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	require.NoError(t, runner.Stop(ctx))
}

func TestCronEveryValidatesArguments(t *testing.T) {
	runner := NewCron()

	_, err := runner.Every(0, func(context.Context) error { return nil })
	require.Error(t, err)

	_, err = runner.Every(time.Second, nil)
	require.Error(t, err)

	_, err = runner.Every(time.Second, func(context.Context) error { return errors.New("failed") })
	require.NoError(t, err)
}

func TestCronStopCancelsRunningJob(t *testing.T) {
	runner := NewCron()
	runner.Start()

	started := make(chan struct{})
	cancelled := make(chan struct{})
	_, err := runner.Every(time.Second, func(ctx context.Context) error {
		close(started)
		<-ctx.Done()
		close(cancelled)
		return nil
	})
	require.NoError(t, err)

	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("cron job did not start")
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	require.NoError(t, runner.Stop(ctx))

	select {
	case <-cancelled:
	default:
		t.Fatal("running job did not observe cancellation")
	}
}
