# Copyright (c) 2026 Sico Authors
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

FROM golang:1.25-alpine AS builder
WORKDIR /app

# Install swag for generating OpenAPI documentation
RUN go install github.com/swaggo/swag/cmd/swag@latest

COPY go.mod go.sum ./
RUN go mod download
COPY . .

# Generate OpenAPI documentation using swag
ARG SWAGGER_MAIN=./cmd/sico-server/main.go
RUN swag init -g ${SWAGGER_MAIN} --parseDependency --parseInternal -o api/openapi

# Compile the Go application
RUN CGO_ENABLED=0 GOOS=linux go build -o sico-backend ./cmd/sico-server

FROM alpine:3.21
RUN apk add --no-cache curl ca-certificates
RUN addgroup -g 10001 sico && adduser -u 10001 -G sico -D sico
WORKDIR /app

COPY --from=builder /app/sico-backend .

# Copy configuration and other files
COPY configs/ ./configs/

RUN chown -R sico:sico /app
USER sico
EXPOSE 8080 50054
CMD ["./sico-backend", "--port=8080"]
