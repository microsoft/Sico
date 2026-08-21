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
