import { type RequestHandler } from "msw";
import { setupServer, type SetupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";

// `onUnhandledRequest: "error"` fails fast on un-mocked requests so silent
// passthrough cannot hide bugs. Call at module scope so the hooks apply
// file-wide.
export function setupMswServer(
  handlers: readonly RequestHandler[],
): SetupServer {
  const server = setupServer(...handlers);
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
  return server;
}
