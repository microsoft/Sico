export { logger } from "./utils/logger";
export { buildLoginRedirect } from "./utils/build-login-redirect";
export { resolveLandingPath } from "./utils/resolve-landing-path";
export * from "./schemas/api";
export * from "./schemas/auth";
export {
  type Agent,
  agentSchema,
  type AgentStatus,
  AgentStatusSchema,
  type EvaluationTaskStatus,
  EvaluationTaskStatusSchema,
  updateAgentInstanceStatus,
} from "./features/digital-worker";
export * from "./constants/http";
export * from "./constants/empty-illustration";
// `getAccessToken` is intentionally NOT re-exported: app code must go
// through `userAtom`. Direct consumers deep-import from `./utils/auth-storage`.
export {
  isAuthenticatedAtom,
  loginAtom,
  logoutAtom,
  userAtom,
} from "./atoms/auth-atom";
export { userModeAtom } from "./atoms/user-mode-atom";
export {
  AUTH_EXPIRES_AT_LS,
  AUTH_TOKEN_LS,
  AUTH_USER_LS,
} from "./utils/local-storage";
export { OfflineBanner } from "./components/shell/offline-banner";
export {
  ErrorFallback,
  type ErrorFallbackProps,
  InnerErrorFallback,
  OuterErrorFallback,
} from "./components/error-boundary/error-fallback";
export { AuthGate } from "./components/auth/auth-gate";
export { ModeGuard } from "./features/rbac-login/mode-guard/mode-guard";
export { Card, type CardProps } from "./components/card";
export { DwAvatar } from "./components/dw-avatar";
export { ErrorView, type ErrorViewKind } from "./components/error-view";
export {
  FilePreview,
  type FilePreviewProps,
  SandboxedIframe,
  type SandboxedIframeProps,
} from "./features/file-preview/index.ts";
export { FileTile, type FileTileProps } from "./components/file-tile";
export { ImageTile, type ImageTileProps } from "./components/image-tile";
export { Markdown, type MarkdownProps } from "./components/markdown";
export {
  MessageState,
  type MessageStateProps,
} from "./components/message-state";
export { UserAvatar } from "./components/user-avatar";
export { AppShell } from "./components/shell/app-shell";
export { type NavItemData } from "./features/sidebar/types";
export { NavRow } from "./features/sidebar/components/nav-row";
export { RailNavRow } from "./features/sidebar/components/rail-nav-row";
export { NavBadge } from "./features/sidebar/components/nav-badge";
export { useSidebarCollapsed } from "./features/sidebar/hooks/use-sidebar-collapsed";
export { LoginLayout } from "./components/shell/login-layout";
export {
  LoginForm,
  type LoginFormProps,
  type LoginMode,
} from "./features/rbac-login";
export {
  Collaboration,
  DeviceButton,
  DigitalWorkerHome,
} from "./features/chat";
export { useFocusFirstHeading } from "./hooks/use-focus-first-heading";
export { useInfiniteScrollSentinel } from "./hooks/use-infinite-scroll-sentinel";
export { useOnlineStatus } from "./hooks/use-online-status";
export {
  createApiClient,
  type CreateApiClientOptions,
  type UnauthorizedEvent,
} from "./services/axios";
export { createQueryClient } from "./services/query-client";
export { ApiClientProvider, useApiClient } from "./services/api-client-context";
export {
  type ChatEndpointsConfig,
  DEFAULT_SICO_CONFIG,
  type SicoConfig,
  SicoConfigProvider,
  useSicoConfig,
} from "./services/sico-config-context";
export {
  synthesizeNetworkError,
  type SynthesizedError,
} from "./services/synthesize-error";
