import axios, {
  type AxiosError,
  AxiosHeaders,
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import { type createStore } from "jotai";
import { z } from "zod";

import { synthesizeNetworkError } from "./synthesize-error";
import { logoutAtom } from "../atoms/auth-atom";
import { HTTP_UNAUTHORIZED } from "../constants/http";
import {
  type ApiResponse,
  apiResponseSchema,
  makeUnauthorizedEnvelope,
} from "../schemas/api";
import { getAccessToken } from "../utils/auth-storage";
import { isSameOriginRequest } from "../utils/is-same-origin-request";
import { logger } from "../utils/logger";

type Store = ReturnType<typeof createStore>;

export type UnauthorizedEvent = Readonly<{
  code: typeof HTTP_UNAUTHORIZED;
  // Resolved request URL when known; omitted for synthetic / aborted requests.
  url?: string;
}>;

export type CreateApiClientOptions = {
  onUnauthorized?: (event: UnauthorizedEvent) => void;
  store?: Store;
  baseURL?: string;
};

const envelopeSchema = apiResponseSchema(z.unknown());

// Defence-in-depth: strip query / fragment so a secret accidentally
// passed as a query param never reaches the logger.
function scrubUrlForLog(url: string | undefined): string | undefined {
  if (!url) {
    return url;
  }
  try {
    const parsed = new URL(url, "http://__scrub__/");
    parsed.search = "";
    parsed.hash = "";
    if (parsed.origin === "http://__scrub__") {
      return parsed.pathname;
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

// The same-origin token gate lives in `../utils/is-same-origin-request`
// (shared with the raw SSE streams).

// All synthetic paths (401, network failure, schema-parse failure)
// return through this so callers MUST narrow on `data.code` before
// touching `data.data`.
function makeSyntheticResponse(
  data: ApiResponse<unknown>,
  status: number,
  error: AxiosError,
): AxiosResponse<ApiResponse<unknown>> {
  return {
    data,
    status,
    statusText: error.response?.statusText ?? "",
    headers: error.response?.headers ?? new AxiosHeaders(),
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- bare `{}` cast TypeErrors on `.headers.get/set`
    config:
      error.config ??
      ({ headers: new AxiosHeaders() } as InternalAxiosRequestConfig),
  };
}

// Request interceptor: attach the bearer token, but only to same-origin
// requests (see `isSameOriginRequest`) so it never leaks to third-party hosts.
function attachAuthHeader(
  config: InternalAxiosRequestConfig,
): InternalAxiosRequestConfig {
  const token = getAccessToken();
  if (token && isSameOriginRequest(config.url, config.baseURL)) {
    // eslint-disable-next-line no-param-reassign -- axios request interceptors must mutate config to attach headers
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}

// Response success interceptor: every body must match the envelope schema.
// A parse failure is downgraded to a synthetic network error so callers
// narrow on `data.code` uniformly instead of trusting an off-contract body.
function parseResponseEnvelope(response: AxiosResponse): AxiosResponse {
  const parsed = envelopeSchema.safeParse(response.data);
  if (!parsed.success) {
    logger.error("zod parse failed", {
      url: scrubUrlForLog(response.config.url),
    });
    return { ...response, data: synthesizeNetworkError() };
  }
  return { ...response, data: parsed.data };
}

// Response error interceptor: 401 → logout + synthetic envelope; unreachable
// network → synthetic envelope; anything else rejects with a real Error.
function handleResponseError(
  error: unknown,
  options: CreateApiClientOptions,
): Promise<AxiosResponse> {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const scrubbedUrl = scrubUrlForLog(error.config?.url);

    if (status === HTTP_UNAUTHORIZED) {
      logger.warn("unauthorized", { url: scrubbedUrl });
      if (options.store) {
        options.store.set(logoutAtom);
      }
      options.onUnauthorized?.({
        code: HTTP_UNAUTHORIZED,
        ...(scrubbedUrl ? { url: scrubbedUrl } : {}),
      });
      return Promise.resolve(
        makeSyntheticResponse(
          makeUnauthorizedEnvelope(),
          HTTP_UNAUTHORIZED,
          error,
        ),
      );
    }

    if (!error.response) {
      logger.error("network unreachable", { url: scrubbedUrl });
      return Promise.resolve(
        makeSyntheticResponse(synthesizeNetworkError(), 0, error),
      );
    }
  }
  return Promise.reject(
    error instanceof Error ? error : new Error(String(error)),
  );
}

export function createApiClient(
  options: CreateApiClientOptions = {},
): AxiosInstance {
  const instance = axios.create(
    options.baseURL ? { baseURL: options.baseURL } : undefined,
  );
  instance.interceptors.request.use(attachAuthHeader);
  instance.interceptors.response.use(parseResponseEnvelope, (error: unknown) =>
    handleResponseError(error, options),
  );
  return instance;
}
