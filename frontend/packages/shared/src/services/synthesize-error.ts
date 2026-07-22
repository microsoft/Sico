/**
 * Copyright (c) 2026 Sico Authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

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
