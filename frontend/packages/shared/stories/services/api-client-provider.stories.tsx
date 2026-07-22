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
