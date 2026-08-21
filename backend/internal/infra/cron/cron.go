package cron

import (
	"context"
	"fmt"
	"runtime/debug"
	"strings"
	"time"
	_ "time/tzdata" // import tzdata for cron timezone support

	default_cron "github.com/robfig/cron/v3"

	"sico-backend/pkg/logger"
)

type EntryID int

type Job func(ctx context.Context) error

type Cron interface {
	Every(interval time.Duration, job Job) (EntryID, error)
	Remove(id EntryID)
	Start()
	Stop(ctx context.Context) error
}

type Schedule interface {
	Next(after time.Time) time.Time
}

type Parser interface {
	Parse(expression, timezone string) (Schedule, error)
}

type cronImpl struct {
	cron   *default_cron.Cron
	ctx    context.Context
	cancel context.CancelFunc
}

func NewCron() Cron {
	ctx, cancel := context.WithCancel(context.Background())
	return &cronImpl{
		cron:   default_cron.New(),
		ctx:    ctx,
		cancel: cancel,
	}
}

func (c *cronImpl) Every(interval time.Duration, job Job) (EntryID, error) {
	if interval <= 0 {
		return 0, fmt.Errorf("cron interval must be positive")
	}
	if job == nil {
		return 0, fmt.Errorf("cron job must not be nil")
	}

	schedule := default_cron.Every(interval)
	wrappedJob := default_cron.NewChain(default_cron.SkipIfStillRunning(default_cron.DefaultLogger)).Then(
		default_cron.FuncJob(func() {
			defer func() {
				if recovered := recover(); recovered != nil {
					logger.Error("cron job panicked: %v\n%s", recovered, debug.Stack())
				}
			}()
			if err := job(c.ctx); err != nil {
				logger.Error("cron job failed: %v", err)
			}
		}),
	)
	id := c.cron.Schedule(schedule, wrappedJob)
	return EntryID(id), nil
}

func (c *cronImpl) Remove(id EntryID) {
	c.cron.Remove(default_cron.EntryID(id))
}

func (c *cronImpl) Start() {
	c.cron.Start()
}

func (c *cronImpl) Stop(ctx context.Context) error {
	c.cancel()
	stopped := c.cron.Stop()
	select {
	case <-stopped.Done():
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

type parserImpl struct {
	parser default_cron.Parser
}

func NewParser() Parser {
	return &parserImpl{
		parser: default_cron.NewParser(
			default_cron.Minute |
				default_cron.Hour |
				default_cron.Dom |
				default_cron.Month |
				default_cron.Dow,
		),
	}
}

func (p *parserImpl) Parse(expression, timezone string) (Schedule, error) {
	expression = strings.TrimSpace(expression)
	if expression == "" {
		return nil, fmt.Errorf("cron expression must not be empty")
	}

	timezone = strings.TrimSpace(timezone)
	if timezone == "" {
		return nil, fmt.Errorf("cron timezone must not be empty")
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		return nil, fmt.Errorf("load cron timezone %q: %w", timezone, err)
	}

	schedule, err := p.parser.Parse("CRON_TZ=" + location.String() + " " + expression)
	if err != nil {
		return nil, fmt.Errorf("parse cron expression: %w", err)
	}
	return schedule, nil
}
