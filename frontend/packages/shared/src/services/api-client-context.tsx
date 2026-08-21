import type { AxiosInstance } from "axios";
import { createContext, type JSX, type ReactNode, useContext } from "react";

const ApiClientContext = createContext<AxiosInstance | null>(null);

export function ApiClientProvider({
  client,
  children,
}: {
  readonly client: AxiosInstance;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <ApiClientContext.Provider value={client}>
      {children}
    </ApiClientContext.Provider>
  );
}

export function useApiClient(): AxiosInstance {
  const client = useContext(ApiClientContext);
  if (!client) {
    throw new Error("useApiClient must be used within an ApiClientProvider");
  }
  return client;
}
