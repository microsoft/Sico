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

package logger

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"go.opentelemetry.io/otel/trace"
)

// LogLevel represents different log levels
type LogLevel int

const (
	DEBUG LogLevel = iota
	INFO
	WARN
	ERROR
	FATAL
)

// String returns the string representation of log level
func (l LogLevel) String() string {
	switch l {
	case DEBUG:
		return "DEBUG"
	case INFO:
		return "INFO"
	case WARN:
		return "WARN"
	case ERROR:
		return "ERROR"
	case FATAL:
		return "FATAL"
	default:
		return "UNKNOWN"
	}
}

// findProjectRoot finds the project root by looking for go.mod file
func findProjectRoot() string {
	// Get the current file's directory
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		return ""
	}

	dir := filepath.Dir(currentFile)

	// Walk up the directory tree looking for go.mod
	for {
		goModPath := filepath.Join(dir, "go.mod")
		if _, err := os.Stat(goModPath); err == nil {
			log.Printf("Project root found at: %s", dir)
			dir = filepath.ToSlash(dir)
			return dir
		}

		parent := filepath.Dir(dir)
		if parent == dir {
			// Reached root directory, go.mod not found
			break
		}
		dir = parent
	}

	return ""
}

// Logger represents our custom logger
type Logger struct {
	*log.Logger
	level LogLevel
}

var (
	defaultLogger *Logger
	projectRoot   = findProjectRoot()
)

func init() {
	defaultLogger = New(INFO)
	// set the format to [time] [level] filename:line - message
}

// New creates a new logger with the specified level
func New(level LogLevel) *Logger {
	return &Logger{
		Logger: log.New(os.Stdout, "", 0), // No default flags, we'll format ourselves
		level:  level,
	}
}

// getCallerInfo returns filename and line number of the caller
func getCallerInfo(skip int) (string, int) {
	_, file, line, ok := runtime.Caller(skip)
	if !ok {
		return "unknown", 0
	}
	// Remove project root from file path for cleaner output
	if projectRoot != "" && len(file) > len(projectRoot) && file[:len(projectRoot)] == projectRoot {
		file = file[len(projectRoot):]
	}
	return file, line
}

// logf formats and outputs the log message
func (l *Logger) logf(level LogLevel, format string, args ...interface{}) {
	if level < l.level {
		return
	}

	// Get caller info (skip 3: logf -> Debug/Info/etc -> actual caller)
	file, line := getCallerInfo(4)

	// Format timestamp
	timestamp := time.Now().Format("2006-01-02 15:04:05")

	// Format the message
	message := fmt.Sprintf(format, args...)

	// Create the log entry
	logEntry := fmt.Sprintf("[%s] [%s] %s:%d - %s",
		timestamp,
		level.String(),
		file,
		line,
		message)

	l.Println(logEntry)

	// Exit for FATAL level
	if level == FATAL {
		os.Exit(1)
	}
}

func (l *Logger) logfCtx(ctx context.Context, level LogLevel, format string, args ...interface{}) {
	if level < l.level {
		return
	}

	logID := ctx.Value("log-id")
	logIDStr := ""
	if logID != nil {
		logIDStr = fmt.Sprintf("[log-id: %v] ", logID)
	}

	spanCtx := trace.SpanContextFromContext(ctx)
	traceStr := ""
	if spanCtx.IsValid() {
		traceStr = fmt.Sprintf("[trace_id: %s span_id: %s] ", spanCtx.TraceID().String(), spanCtx.SpanID().String())
	}

	// Get caller info (skip 3: logf -> Debug/Info/etc -> actual caller)
	file, line := getCallerInfo(4)

	// Format timestamp
	timestamp := time.Now().Format("2006-01-02 15:04:05")

	// Format the message
	message := fmt.Sprintf(format, args...)

	// Create the log entry
	logEntry := fmt.Sprintf("[%s] [%s] %s%s%s:%d - %s",
		timestamp,
		level.String(),
		logIDStr,
		traceStr,
		file,
		line,
		message)

	l.Println(logEntry)

	// Exit for FATAL level
	if level == FATAL {
		os.Exit(1)
	}
}

func (l *Logger) PrintTraceInfo() {
	for i := 1; ; i++ {
		_, file, line, ok := runtime.Caller(i)
		if !ok {
			break
		}
		if projectRoot != "" && len(file) > len(projectRoot) && file[:len(projectRoot)] == projectRoot {
			file = file[len(projectRoot):]
		}
		l.Info("Trace %d: %s:%d", i, file, line)
	}
}

// Debug logs a debug message
func (l *Logger) Debug(format string, args ...interface{}) {
	l.logf(DEBUG, format, args...)
}

// Info logs an info message
func (l *Logger) Info(format string, args ...interface{}) {
	l.logf(INFO, format, args...)
}

// Warn logs a warning message
func (l *Logger) Warn(format string, args ...interface{}) {
	l.logf(WARN, format, args...)
}

// Error logs an error message
func (l *Logger) Error(format string, args ...interface{}) {
	l.logf(ERROR, format, args...)
}

// Fatal logs a fatal message and exits
func (l *Logger) Fatal(format string, args ...interface{}) {
	l.logf(FATAL, format, args...)
}

// SetLevel sets the minimum log level
func (l *Logger) SetLevel(level LogLevel) {
	l.level = level
}

// GetLogger returns the default logger instance
func GetLogger() *Logger {
	return defaultLogger
}

func (l *Logger) CtxDebug(ctx context.Context, format string, args ...interface{}) {
	l.logfCtx(ctx, DEBUG, format, args...)
}
func (l *Logger) CtxInfo(ctx context.Context, format string, args ...interface{}) {
	l.logfCtx(ctx, INFO, format, args...)
}
func (l *Logger) CtxWarn(ctx context.Context, format string, args ...interface{}) {
	l.logfCtx(ctx, WARN, format, args...)
}
func (l *Logger) CtxError(ctx context.Context, format string, args ...interface{}) {
	l.logfCtx(ctx, ERROR, format, args...)
}
func (l *Logger) CtxFatal(ctx context.Context, format string, args ...interface{}) {
	l.logfCtx(ctx, FATAL, format, args...)
}

// Package level functions for convenience
func PrintTraceInfo() {
	defaultLogger.PrintTraceInfo()
}
func Debug(format string, args ...interface{}) {
	defaultLogger.Debug(format, args...)
}
func Info(format string, args ...interface{}) {
	defaultLogger.Info(format, args...)
}
func Warn(format string, args ...interface{}) {
	defaultLogger.Warn(format, args...)
}
func Error(format string, args ...interface{}) {
	defaultLogger.Error(format, args...)
}
func Fatal(format string, args ...interface{}) {
	defaultLogger.Fatal(format, args...)
}
func CtxDebug(ctx context.Context, format string, args ...interface{}) {
	defaultLogger.CtxDebug(ctx, format, args...)
}
func CtxInfo(ctx context.Context, format string, args ...interface{}) {
	defaultLogger.CtxInfo(ctx, format, args...)
}
func CtxWarn(ctx context.Context, format string, args ...interface{}) {
	defaultLogger.CtxWarn(ctx, format, args...)
}
func CtxError(ctx context.Context, format string, args ...interface{}) {
	defaultLogger.CtxError(ctx, format, args...)
}
func CtxFatal(ctx context.Context, format string, args ...interface{}) {
	defaultLogger.CtxFatal(ctx, format, args...)
}
