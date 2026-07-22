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

import { renderHook } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_SICO_CONFIG,
  SicoConfigProvider,
  useSicoConfig,
} from "@/services/sico-config-context";

describe("useSicoConfig", () => {
  // The defining difference from ApiClientProvider: sico itself never wraps
  // the provider, so the bare hook must return defaults, not throw.
  it("returns DEFAULT_SICO_CONFIG when no provider wraps it", () => {
    const { result } = renderHook(() => useSicoConfig());
    expect(result.current).toEqual(DEFAULT_SICO_CONFIG);
  });

  it("returns DEFAULT_SICO_CONFIG when provider has no override", () => {
    const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
      <SicoConfigProvider>{children}</SicoConfigProvider>
    );
    const { result } = renderHook(() => useSicoConfig(), { wrapper });
    expect(result.current).toEqual(DEFAULT_SICO_CONFIG);
  });

  it("applies a partial override over the defaults", () => {
    // dwp's real config: flip both flags away from the sico defaults.
    const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
      <SicoConfigProvider
        config={{
          loginPrefillCredentials: false,
          digitalWorkerCardShowStatus: true,
        }}
      >
        {children}
      </SicoConfigProvider>
    );
    const { result } = renderHook(() => useSicoConfig(), { wrapper });
    expect(result.current).toEqual({
      loginPrefillCredentials: false,
      digitalWorkerCardShowStatus: true,
    });
  });

  it("leaves untouched flags at their defaults when overriding one", () => {
    // Override only the card flag; the login flag must stay at the default.
    const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
      <SicoConfigProvider config={{ digitalWorkerCardShowStatus: true }}>
        {children}
      </SicoConfigProvider>
    );
    const { result } = renderHook(() => useSicoConfig(), { wrapper });
    expect(result.current.loginPrefillCredentials).toBe(
      DEFAULT_SICO_CONFIG.loginPrefillCredentials,
    );
    expect(result.current.digitalWorkerCardShowStatus).toBe(true);
  });
});
