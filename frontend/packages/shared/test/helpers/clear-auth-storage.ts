import {
  AUTH_EXPIRES_AT_LS,
  AUTH_TOKEN_LS,
  AUTH_USER_LS,
  removeItemFromLocalStorage,
  USER_MODE_LS,
} from "@/utils/local-storage";

// Mirrors prod `clearAuthStorage()` — kept local so tests don't cross
// the source/test boundary just to flush LS.
export function clearAuthStorage(): void {
  removeItemFromLocalStorage(AUTH_TOKEN_LS);
  removeItemFromLocalStorage(AUTH_USER_LS);
  removeItemFromLocalStorage(AUTH_EXPIRES_AT_LS);
  removeItemFromLocalStorage(USER_MODE_LS);
}
