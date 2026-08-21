import {
  AUTH_EXPIRES_AT_LS,
  AUTH_TOKEN_LS,
  AUTH_USER_LS,
  removeItemFromLocalStorage,
  USER_MODE_LS,
} from "@sico/shared/utils/local-storage.ts";

// Mirrors prod `clearAuthStorage()` — kept local so app tests don't
// reach into `@sico/shared` internals just to flush LS.
export function clearAuthStorage(): void {
  removeItemFromLocalStorage(AUTH_TOKEN_LS);
  removeItemFromLocalStorage(AUTH_USER_LS);
  removeItemFromLocalStorage(AUTH_EXPIRES_AT_LS);
  removeItemFromLocalStorage(USER_MODE_LS);
}
