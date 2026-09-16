import axios, {
  type AxiosError,
  AxiosHeaders,
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import { type createStore } from "jotai";
import { z } from "zod";

import { getOrganizationHeaders } from "./organization-header";
import { synthesizeNetworkError } from "./synthesize-error";
import { isAuthenticatedAtom, logoutAtom } from "../atoms/auth-atom";
import { HTTP_UNAUTHORIZED } from "../constants/http";
import {
  type ApiResponse,
  apiResponseSchema,
  makeUnauthorizedEnvelope,
} from "../schemas/api";
import { getAccessToken } from "../utils/auth-storage";
import { isSameOriginRequest } from "../utils/is-same-origin-request";
import { AUTH_TOKEN_LS, getItemFromLocalStorage } from "../utils/local-storage";
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
  getOrganizationId?: () => number | null;
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
  requestTokens: WeakMap<InternalAxiosRequestConfig, string | null>,
): InternalAxiosRequestConfig {
  if (!isSameOriginRequest(config.url, config.baseURL)) {
    return config;
  }
  if (config.headers.has("Authorization")) {
    return config;
  }
  const token = getAccessToken();
  requestTokens.set(config, token);
  if (token) {
    // eslint-disable-next-line no-param-reassign -- axios request interceptors must mutate config to attach headers
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}

function attachOrganizationHeader(
  config: InternalAxiosRequestConfig,
  getOrganizationId: CreateApiClientOptions["getOrganizationId"],
): InternalAxiosRequestConfig {
  if (isSameOriginRequest(config.url, config.baseURL)) {
    config.headers.set(getOrganizationHeaders(getOrganizationId));
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
  requestTokens: WeakMap<InternalAxiosRequestConfig, string | null>,
): Promise<AxiosResponse> {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const scrubbedUrl = scrubUrlForLog(error.config?.url);

    if (status === HTTP_UNAUTHORIZED) {
      logger.warn("unauthorized", { url: scrubbedUrl });
      const requestToken = error.config
        ? requestTokens.get(error.config)
        : undefined;
      const rawCurrentToken = getItemFromLocalStorage(AUTH_TOKEN_LS);
      const currentToken = rawCurrentToken === "" ? null : rawCurrentToken;
      const shouldHandleUnauthorized =
        requestToken !== undefined &&
        requestToken === currentToken &&
        (options.store === undefined || options.store.get(isAuthenticatedAtom));
      if (shouldHandleUnauthorized) {
        options.store?.set(logoutAtom);
        options.onUnauthorized?.({
          code: HTTP_UNAUTHORIZED,
          ...(scrubbedUrl ? { url: scrubbedUrl } : {}),
        });
      }
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
  const requestTokens = new WeakMap<
    InternalAxiosRequestConfig,
    string | null
  >();
  instance.interceptors.request.use((config) =>
    attachOrganizationHeader(
      attachAuthHeader(config, requestTokens),
      options.getOrganizationId,
    ),
  );
  instance.interceptors.response.use(parseResponseEnvelope, (error: unknown) =>
    handleResponseError(error, options, requestTokens),
  );
  return instance;
}
