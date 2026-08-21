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
