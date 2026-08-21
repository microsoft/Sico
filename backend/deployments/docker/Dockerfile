FROM golang:1.25-alpine AS builder
WORKDIR /app

# Install swag for generating OpenAPI documentation
RUN --mount=type=cache,target=/go/pkg/mod \
	--mount=type=cache,target=/root/.cache/go-build \
	go install github.com/swaggo/swag/cmd/swag@latest

COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
	go mod download
COPY . .

# Ensure checked-in OpenTelemetry interface wrappers match their source interfaces.
RUN --mount=type=cache,target=/go/pkg/mod \
	--mount=type=cache,target=/root/.cache/go-build \
	go run ./cmd/otelwrapgen -check

# Generate OpenAPI documentation using swag
ARG SWAGGER_MAIN=./cmd/sico-server/main.go
RUN --mount=type=cache,target=/go/pkg/mod \
	--mount=type=cache,target=/root/.cache/go-build \
	swag init -g ${SWAGGER_MAIN} --parseDependency --parseInternal --tags '!Internal' -o api/openapi

# Compile the Go application
RUN --mount=type=cache,target=/go/pkg/mod \
	--mount=type=cache,target=/root/.cache/go-build \
	CGO_ENABLED=0 GOOS=linux go build -o sico-backend ./cmd/sico-server

FROM alpine:3.21
LABEL org.opencontainers.image.licenses="MIT"
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
