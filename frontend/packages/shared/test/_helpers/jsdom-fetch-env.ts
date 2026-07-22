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

import { builtinEnvironments } from "vitest/environments";
import type { Environment } from "vitest/environments";

// Captured in the Node realm at module-eval time — BEFORE jsdom's setup
// overwrites the globals — so these are Node's native, undici-compatible
// classes. jsdom installs its own AbortController/AbortSignal that undici's
// fetch interceptor brand-rejects ("Expected signal to be an instance of
// AbortSignal"); restoring the natives lets raw-fetch SSE tests run under
// jsdom (which we still need for relative-URL resolution against localhost).
const NativeAbortController = globalThis.AbortController;
const NativeAbortSignal = globalThis.AbortSignal;

const env: Environment = {
  name: "jsdom-fetch",
  transformMode: "web",
  async setup(global, options) {
    const jsdom = await builtinEnvironments.jsdom.setup(global, options);
    Object.assign(global, {
      AbortController: NativeAbortController,
      AbortSignal: NativeAbortSignal,
    });
    return jsdom;
  },
};

export default env;
