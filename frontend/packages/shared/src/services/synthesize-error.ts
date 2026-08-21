// Synthetic envelope with the canonical `CLIENT_NETWORK_ERROR_CODE`.
// Empty `msg` falls back to the default so toasts / logs are never blank.
import { CLIENT_NETWORK_ERROR_CODE } from "../constants/http";

export type SynthesizedError = {
  code: typeof CLIENT_NETWORK_ERROR_CODE;
  msg: string;
  data: Record<string, never>;
};

const DEFAULT_NETWORK_ERROR_MESSAGE = "unknown error";

export function synthesizeNetworkError(msg?: string): SynthesizedError {
  return {
    code: CLIENT_NETWORK_ERROR_CODE,
    msg:
      msg !== undefined && msg.length > 0 ? msg : DEFAULT_NETWORK_ERROR_MESSAGE,
    data: {},
  };
}
