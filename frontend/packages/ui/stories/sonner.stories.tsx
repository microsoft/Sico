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

import { Button } from "../src/components/ui/button";
// The SICO-wrapped `toast` (not sonner's raw one) so `invert: true` demos
// route to the inverted surface, matching production.
import { toast, Toaster } from "../src/components/ui/sonner";

/**
 * Sonner has no props to drive from Controls — toasts are fired
 * imperatively via `toast.*`. Each story renders a trigger button plus the
 * `<Toaster>`; click the button to fire that surface × kind.
 *
 * `<Toaster>` mounts two surfaces at fixed positions: white (informational)
 * at bottom-right, black (transient, `invert: true`) at bottom-center. The
 * `invert` flag both styles the card and routes it to the black surface —
 * so black stories appear centered, white ones bottom-right.
 *
 * `label` / `fire` are scaffolding args (not real props), so each story
 * pins `parameters.docs.source.code` to the real `toast.*` call it fires —
 * otherwise autodocs' "Show code" would dump the trigger `<Button>`.
 */
type StoryArgs = { label: string; fire: () => void };

const meta = {
  title: "Components/Sonner",
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <>
        <Story />
        <Toaster />
      </>
    ),
  ],
  render: ({ label, fire }) => <Button onClick={fire}>{label}</Button>,
  args: { label: "Fire toast" },
} satisfies Meta<StoryArgs>;

export default meta;
type Story = StoryObj<StoryArgs>;

const snippet = (code: string): Story["parameters"] => ({
  docs: { source: { code } },
});

/* ============ White surface — informational ============ */

/**
 * Loading / progress toast on the white surface. Shows the indeterminate
 * primary hairline pinned to the card's bottom edge (`toast-loading-bar`),
 * body text only. Sonner suppresses the close X on `loading` toasts by
 * design (they're dismissed programmatically) — see `WhiteDismissible`
 * for the close-button slot.
 */
export const WhiteLoading: Story = {
  parameters: snippet(
    'toast.loading("<Digital Worker Name> is in the onboarding process.");',
  ),
  args: {
    label: "Fire loading",
    fire: () =>
      toast.loading("<Digital Worker Name> is in the onboarding process."),
  },
};

/**
 * Info toast — `IconInfoCircleFilled` in the muted secondary foreground on
 * the plain white surface, paired with an optional `View` action. Info stays
 * on white with a neutral glyph so it doesn't clash with a warm tint.
 */
export const WhiteInfo: Story = {
  parameters: snippet(
    'toast.info("Session continues in the background.", {\n  action: { label: "View", onClick: () => {} },\n});',
  ),
  args: {
    label: "Fire info",
    fire: () =>
      toast.info("Session continues in the background.", {
        action: { label: "View", onClick: () => {} },
      }),
  },
};

/**
 * Warning toast — `IconAlertTriangleFilled` in the warning hue over the warm
 * `status-warning-subtle-fill` tint. Warning and error are the two kinds that
 * carry a tint; info / success / loading / default sit on plain white.
 */
export const WhiteWarning: Story = {
  parameters: snippet(
    'toast.warning("Scheduled <task name> needs your attention.", {\n  action: { label: "View", onClick: () => {} },\n});',
  ),
  args: {
    label: "Fire warning",
    fire: () =>
      toast.warning("Scheduled <task name> needs your attention.", {
        action: { label: "View", onClick: () => {} },
      }),
  },
};

/**
 * Error toast — `IconCircleXFilled` in the danger hue over the pink
 * `status-error-subtle-fill` surface, with an optional `View` action.
 */
export const WhiteError: Story = {
  parameters: snippet(
    'toast.error("Scheduled <task name> failed.", {\n  action: { label: "View", onClick: () => {} },\n});',
  ),
  args: {
    label: "Fire error",
    fire: () =>
      toast.error("Scheduled <task name> failed.", {
        action: { label: "View", onClick: () => {} },
      }),
  },
};

/**
 * Success toast — `IconCircleCheckFilled` in the success hue on the plain
 * white surface. Pairs with an optional `View` destination.
 */
export const WhiteSuccess: Story = {
  parameters: snippet(
    'toast.success("Check out the evaluation results.", {\n  action: { label: "View", onClick: () => {} },\n});',
  ),
  args: {
    label: "Fire success",
    fire: () =>
      toast.success("Check out the evaluation results.", {
        action: { label: "View", onClick: () => {} },
      }),
  },
};

/**
 * Plain toast — a bare `toast()` with no kind. Renders on the ungated white
 * base (no icon, no tint), confirming a typeless toast still paints an opaque
 * card rather than a transparent one.
 */
export const WhitePlain: Story = {
  parameters: snippet('toast("Draft saved to your workspace.");'),
  args: {
    label: "Fire plain",
    fire: () => toast("Draft saved to your workspace."),
  },
};

/**
 * White toast with the opt-in close X (`closeButton: true`), pulled out of
 * sonner's absolute top-corner into the inline trailing slot (order-last).
 * Sonner renders the dismiss button on every kind except `loading`, so this
 * uses `error` to show the close-button slot styling.
 */
export const WhiteDismissible: Story = {
  parameters: snippet(
    'toast.error("Scheduled <task name> failed.", { closeButton: true });',
  ),
  args: {
    label: "Fire dismissible",
    fire: () =>
      toast.error("Scheduled <task name> failed.", { closeButton: true }),
  },
};

/* ============ Black surface — transient (invert: true) ============ */
/**
 * Inverted success — fast confirmation feedback. Hug-width, tighter
 * footprint, no `View` / close / progress. Opted in via `invert: true`.
 */
export const BlackSuccess: Story = {
  parameters: snippet(
    'toast.success("This training has been passed.", { invert: true });',
  ),
  args: {
    label: "Fire inverted success",
    fire: () =>
      toast.success("This training has been passed.", { invert: true }),
  },
};

/**
 * Inverted info — same transient register as `BlackSuccess`; the info glyph
 * defaults to white (`icon-on-inverted`) on the dark surface, no status hue.
 */
export const BlackInfo: Story = {
  parameters: snippet(
    'toast.info("Session continues in the background.", { invert: true });',
  ),
  args: {
    label: "Fire inverted info",
    fire: () =>
      toast.info("Session continues in the background.", { invert: true }),
  },
};

/**
 * Inverted warning — warning-hue glyph on the dark surface.
 */
export const BlackWarning: Story = {
  parameters: snippet(
    'toast.warning("Heads up — connection is unstable.", { invert: true });',
  ),
  args: {
    label: "Fire inverted warning",
    fire: () =>
      toast.warning("Heads up — connection is unstable.", { invert: true }),
  },
};

/**
 * Inverted error — danger-hue glyph on the dark surface.
 */
export const BlackError: Story = {
  parameters: snippet(
    'toast.error("Error message wording wordi…", { invert: true });',
  ),
  args: {
    label: "Fire inverted error",
    fire: () => toast.error("Error message wording wordi…", { invert: true }),
  },
};

/**
 * Inverted plain — a bare `toast()` with no kind renders without an icon
 * (`default` type has no icon mapping). Pure text feedback.
 */
export const BlackPlain: Story = {
  parameters: snippet(
    'toast("Take over ended. Device is now view-only.", { invert: true });',
  ),
  args: {
    label: "Fire inverted plain",
    fire: () =>
      toast("Take over ended. Device is now view-only.", { invert: true }),
  },
};
