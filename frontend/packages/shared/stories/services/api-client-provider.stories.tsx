import type { Meta, StoryObj } from "@storybook/react-vite";
import axios from "axios";
import { Component, type ReactElement, type ReactNode } from "react";

import { ApiClientProvider, useApiClient } from "@/services/api-client-context";

function ApiClientDemo(): ReactElement {
  const client = useApiClient();
  const baseURL = client.defaults.baseURL ?? "<no baseURL>";
  return (
    <div className="bg-background text-foreground-primary inline-block rounded-md border p-3 text-sm">
      <div className="font-medium">useApiClient resolved</div>
      <div className="text-foreground-secondary font-mono">
        baseURL: {baseURL}
      </div>
    </div>
  );
}

type BoundaryState = { readonly message: string | null };

class BoundaryFallback extends Component<
  { readonly children: ReactNode },
  BoundaryState
> {
  state: BoundaryState = { message: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return {
      message: error instanceof Error ? error.message : String(error),
    };
  }

  render(): ReactNode {
    const { message } = this.state;
    const { children } = this.props;
    if (message !== null) {
      return (
        <div className="bg-background text-foreground-primary inline-block rounded-md border p-3 text-sm">
          <div className="font-medium">Threw:</div>
          <div className="text-foreground-secondary font-mono">{message}</div>
        </div>
      );
    }
    return children;
  }
}

const meta = {
  title: "Components/ApiClientProvider",
  component: ApiClientDemo,
  tags: ["autodocs"],
} satisfies Meta<typeof ApiClientDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Provider present — `useApiClient` resolves the injected axios instance
 *  and renders its `baseURL`. */
export const Default: Story = {
  render: (): ReactElement => (
    <ApiClientProvider
      client={axios.create({ baseURL: "https://api.example.test" })}
    >
      <ApiClientDemo />
    </ApiClientProvider>
  ),
};

/** No provider in the tree — `useApiClient` throws; the boundary catches
 *  and surfaces the error message. */
export const MissingProvider: Story = {
  render: (): ReactElement => (
    <BoundaryFallback>
      <ApiClientDemo />
    </BoundaryFallback>
  ),
};
