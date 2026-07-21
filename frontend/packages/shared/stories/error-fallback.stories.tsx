import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactElement } from "react";

import { ErrorFallback } from "@/components/error-boundary/error-fallback";

// Wrapper height for inner story stages; ensures the card is visible inside the
// Storybook canvas without scrolling. Stage uses `bg-background` to match the
// runtime surface utility used by route shells.
const STAGE_CLASSES = "bg-background relative min-h-32";

const noop = (): void => {};

// autodocs disabled: outer variant uses fixed inset-0, rendering multiple
// stories simultaneously would cause overlay collisions.
const meta = {
  title: "Components/ErrorFallback",
  component: ErrorFallback,
  // `resetErrorBoundary` is a no-op across every story; each story adds its
  // own `error` + `variant`. The stage wrappers differ per variant (inner
  // card vs full-height outer overlay), so they stay in each `render`.
  args: { resetErrorBoundary: noop },
} satisfies Meta<typeof ErrorFallback>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Inner variant in its initial state — recoverable card shown inside a
 *  route shell. */
export const InnerInitial: Story = {
  args: {
    error: new Error("Inner error"),
    variant: "inner",
  },
  render: (args): ReactElement => (
    <div className={STAGE_CLASSES}>
      <ErrorFallback
        error={args.error}
        resetErrorBoundary={args.resetErrorBoundary}
        variant={args.variant}
      />
    </div>
  ),
};

/** Inner variant after the user clicks retry — production wires the reset
 *  to the parent boundary; here it is visual-only. */
export const InnerRetryClicked: Story = {
  args: {
    error: new Error("Inner error"),
    variant: "inner",
  },
  render: (args): ReactElement => (
    <div className={STAGE_CLASSES}>
      <p className="text-foreground-secondary p-4 text-sm">
        Retry click handled by parent &lt;ErrorBoundary&gt; in production;
        visual only here.
      </p>
      <ErrorFallback
        error={args.error}
        resetErrorBoundary={args.resetErrorBoundary}
        variant={args.variant}
      />
    </div>
  ),
};

/** Outer variant — full-page unrecoverable bootstrap failure with a reload
 *  affordance. */
export const OuterUnrecoverable: Story = {
  args: {
    error: new Error("Application failed to bootstrap"),
    variant: "outer",
    onReload: noop,
  },
  render: (args): ReactElement => {
    // `args` is typed as the discriminated union; narrow on `variant`
    // so the `onReload` field is statically reachable on the `"outer"`
    // branch.
    if (args.variant !== "outer") {
      throw new Error("OuterUnrecoverable story requires variant='outer'");
    }
    return (
      <div className="relative h-96 overflow-hidden">
        <ErrorFallback
          error={args.error}
          resetErrorBoundary={args.resetErrorBoundary}
          variant={args.variant}
          onReload={args.onReload}
        />
      </div>
    );
  },
};
