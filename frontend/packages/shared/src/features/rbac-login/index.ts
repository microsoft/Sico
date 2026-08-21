// Only the JSX entry + route wiring are public. Hooks / services / internal
// schemas / utils stay internal — DWP mounts <LoginForm> / <LoginPage> directly
// with its own apiClient.
export { LoginPage } from "./components/login-page";
export {
  LoginForm,
  type LoginFormProps,
  type LoginMode,
} from "./components/login-form";
export { RegisterPage } from "./components/register-page";
export {
  RegisterForm,
  type RegisterFormProps,
} from "./components/register-form";
export { useLogout } from "./hooks/use-logout";
export {
  type AuthModeSearch,
  authModeSearchSchema,
  modeFromSearch,
  searchForMode,
} from "./schemas/auth-mode";
export { type LoginSearch, loginSearchSchema } from "./schemas/login-search";
