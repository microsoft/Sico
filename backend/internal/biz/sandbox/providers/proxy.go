package providers

import (
	"context"
	"strings"
	"time"

	"github.com/gorilla/websocket"

	"sico-backend/pkg/safego"
)

func proxyWebSocketBidirectional(client, server *websocket.Conn) {
	errCh := make(chan error, 2)
	stopCh := make(chan struct{})
	defer close(stopCh)
	reportErr := makeWSErrReporter(errCh)

	armWSLiveness(client)
	armWSLiveness(server)

	ctx := context.Background()
	safego.Go(ctx, func() { wsKeepAlive(client, stopCh, reportErr) })
	safego.Go(ctx, func() { wsKeepAlive(server, stopCh, reportErr) })
	safego.Go(ctx, func() { wsProxyCopy(server, client, reportErr) })
	safego.Go(ctx, func() { wsProxyCopy(client, server, reportErr) })
	<-errCh

	closeDeadline := time.Now().Add(time.Second)
	_ = client.WriteControl(
		websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""),
		closeDeadline,
	)
	_ = server.WriteControl(
		websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""),
		closeDeadline,
	)
}

func proxyEmulatorWebSocketBidirectional(client, server *websocket.Conn) {
	errCh := make(chan error, 2)
	stopCh := make(chan struct{})
	defer close(stopCh)
	reportErr := makeWSErrReporter(errCh)

	ctx := context.Background()
	safego.Go(ctx, func() { wsKeepAlive(client, stopCh, reportErr) })
	safego.Go(ctx, func() { wsKeepAlive(server, stopCh, reportErr) })
	safego.Go(ctx, func() { wsProxyCopyWithoutReadDeadline(server, client, reportErr) })
	safego.Go(ctx, func() { wsProxyCopyWithoutReadDeadline(client, server, reportErr) })
	<-errCh

	closeDeadline := time.Now().Add(time.Second)
	_ = client.WriteControl(
		websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""),
		closeDeadline,
	)
	_ = server.WriteControl(
		websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""),
		closeDeadline,
	)
}

var (
	wsPingInterval = 25 * time.Second
	wsPingTimeout  = 10 * time.Second
	wsReadTimeout  = 60 * time.Second
)

func armWSLiveness(connection *websocket.Conn) {
	_ = connection.SetReadDeadline(time.Now().Add(wsReadTimeout))
	connection.SetPongHandler(func(string) error {
		return connection.SetReadDeadline(time.Now().Add(wsReadTimeout))
	})
}

func makeWSErrReporter(errCh chan<- error) func(error) {
	return func(err error) {
		if err == nil {
			return
		}
		select {
		case errCh <- err:
		default:
		}
	}
}

func wsKeepAlive(connection *websocket.Conn, stopCh <-chan struct{}, reportErr func(error)) {
	ticker := time.NewTicker(wsPingInterval)
	defer ticker.Stop()
	for {
		select {
		case <-stopCh:
			return
		case <-ticker.C:
			deadline := time.Now().Add(wsPingTimeout)
			if err := connection.WriteControl(websocket.PingMessage, []byte("ping"), deadline); err != nil {
				reportErr(err)
				return
			}
		}
	}
}

func wsProxyCopy(destination, source *websocket.Conn, reportErr func(error)) {
	for {
		messageType, payload, err := source.ReadMessage()
		if err != nil {
			reportErr(err)
			return
		}
		_ = source.SetReadDeadline(time.Now().Add(wsReadTimeout))
		if err := destination.WriteMessage(messageType, payload); err != nil {
			reportErr(err)
			return
		}
	}
}

func wsProxyCopyWithoutReadDeadline(destination, source *websocket.Conn, reportErr func(error)) {
	for {
		messageType, payload, err := source.ReadMessage()
		if err != nil {
			reportErr(err)
			return
		}
		if err := destination.WriteMessage(messageType, payload); err != nil {
			reportErr(err)
			return
		}
	}
}

func singleJoiningSlash(left, right string) string {
	leftSlash, rightSlash := strings.HasSuffix(left, "/"), strings.HasPrefix(right, "/")
	switch {
	case leftSlash && rightSlash:
		return left + right[1:]
	case !leftSlash && !rightSlash:
		return left + "/" + right
	default:
		return left + right
	}
}
