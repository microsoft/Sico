/**
 * Re-export of `@sico/shared/testing/network` (the canonical location).
 * Kept here so existing imports of `test/helpers/network` keep working
 * without crossing the package barrel from `test/` files.
 */
export {
  fireNetworkStatus,
  restoreOnline,
  setOnline,
} from "../../src/testing/network";
