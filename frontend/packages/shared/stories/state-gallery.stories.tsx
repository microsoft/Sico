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

import { Skeleton, Spinner } from "@sico/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { AxiosError } from "axios";
import type { JSX, ReactNode } from "react";
import { ZodError } from "zod";

import { ErrorView } from "@/components/error-view/error-view";
import { MessageState } from "@/components/message-state";
import { EmptyState as DigitalWorkersEmptyState } from "@/features/digital-worker/components/empty-state";
import { LoadingOverlay } from "@/features/file-preview/components/loading-overlay";
import { UnpreviewableState } from "@/features/file-preview/components/unpreviewable-state";
import { AssetsEmpty } from "@/features/projects/components/assets-empty";
import { EmptyState as ProjectsEmptyState } from "@/features/projects/components/empty-state";

// A single gallery of every loading / error / empty surface, so reviewers (and
// Playwright snapshots) can eyeball all of them — and their centering — in one
// place. Composed of many primitives, so it uses `Meta<Args>` per stories.md,
// not a single-component meta.
const meta: Meta<Record<string, never>> = {
  title: "States/Gallery",
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<Record<string, never>>;

const noop = (): void => {};

// Each cell frames a state in a fixed-height bordered box so the gallery shows
// whether the state CENTERS itself or pins to the top — the whole point of the
// audit. The label sits above the framed stage.
function Cell({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-foreground-secondary text-xs font-medium">{label}</p>
      <div className="border-stroke-subtle-card-rest bg-surface-basic relative h-64 overflow-hidden rounded-lg border">
        {children}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-foreground-primary text-lg font-medium">{title}</h2>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        {children}
      </div>
    </section>
  );
}

// Errors that classifyError buckets into each of its 4 kinds, so ErrorView
// renders all 4 copy variants from real inputs (not faked copy).
const networkError = Object.assign(new Error("aborted"), {
  name: "AbortError",
});
const serverError = new AxiosError(
  "Request failed",
  "ERR_BAD_RESPONSE",
  undefined,
  undefined,
  // Minimal response shape classifyError reads (`response.status`).
  { status: 500 } as AxiosError["response"],
);
const schemaError = new ZodError([]);
const unknownError = new Error("Something unexpected");

/** Every loading affordance: the bare Spinner, the file-preview LoadingOverlay
 *  (opaque + transparent), and the Skeleton primitive. */
export const Loading: Story = {
  render: (): JSX.Element => (
    <div className="bg-surface-canvas flex flex-col gap-8 p-8">
      <Section title="Loading">
        <Cell label="Spinner (default)">
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        </Cell>
        <Cell label="LoadingOverlay (opaque surface)">
          <LoadingOverlay />
        </Cell>
        <Cell label="LoadingOverlay (transparent, over dark stage)">
          <div className="bg-surface-inverted h-full">
            <LoadingOverlay surface={false} />
          </div>
        </Cell>
        <Cell label="Skeleton (lines)">
          <div className="flex h-full flex-col gap-3 p-4">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </Cell>
      </Section>
    </div>
  ),
};

/** ErrorView across all 4 classifyError kinds — each self-centers in its box
 *  via the `role="alert"` fill wrapper. */
export const Errors: Story = {
  render: (): JSX.Element => (
    <div className="bg-surface-canvas flex flex-col gap-8 p-8">
      <Section title="Error (ErrorView — self-centering)">
        <Cell label="network">
          <ErrorView error={networkError} resetErrorBoundary={noop} />
        </Cell>
        <Cell label="server">
          <ErrorView error={serverError} resetErrorBoundary={noop} />
        </Cell>
        <Cell label="schema">
          <ErrorView error={schemaError} resetErrorBoundary={noop} />
        </Cell>
        <Cell label="unknown">
          <ErrorView error={unknownError} resetErrorBoundary={noop} />
        </Cell>
      </Section>
    </div>
  ),
};

/** Every empty surface side by side, so the per-feature illustrations and the
 *  centering behaviour are directly comparable. */
export const Empty: Story = {
  render: (): JSX.Element => (
    <div className="bg-surface-canvas flex flex-col gap-8 p-8">
      <Section title="Empty">
        <Cell label="Projects (self-centering)">
          <ProjectsEmptyState />
        </Cell>
        <Cell label="Digital Workers (self-centering)">
          <DigitalWorkersEmptyState />
        </Cell>
        <Cell label="Assets — category (consumer-centered)">
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <AssetsEmpty variant="category" category="all" />
          </div>
        </Cell>
        <Cell label="Assets — search (consumer-centered)">
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <AssetsEmpty variant="search" query="invoices" />
          </div>
        </Cell>
        <Cell label="Unpreviewable file (self-centering)">
          <UnpreviewableState />
        </Cell>
        <Cell label="MessageState (bare — no centering wrapper)">
          <MessageState
            illustrationUrl=""
            illustrationWidth={0}
            illustrationHeight={0}
            heading="Bare MessageState"
            body="Pins to the top without a fill wrapper."
          />
        </Cell>
      </Section>
    </div>
  ),
};
