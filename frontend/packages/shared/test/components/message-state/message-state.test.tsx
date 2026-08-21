import { render, screen } from "@testing-library/react";
import type { JSX } from "react";
import { describe, expect, it } from "vitest";

import { MessageState } from "@/components/message-state";

// MessageState is the shared empty/error primitive. `fill` is the opt-in that
// grows + centers it in the parent instead of sizing to content — so callers
// stop hand-rolling a `flex flex-1 items-center justify-center` wrapper.
// A local render helper (not prop-spreading, which lint forbids) keeps the two
// cases to the single `fill` axis under test.
function renderState(fill: boolean): void {
  const state: JSX.Element = fill ? (
    <MessageState
      fill
      illustrationUrl="data:image/svg+xml,<svg/>"
      illustrationWidth={0}
      illustrationHeight={0}
      heading="Nothing here"
      body="Come back later."
    />
  ) : (
    <MessageState
      illustrationUrl="data:image/svg+xml,<svg/>"
      illustrationWidth={0}
      illustrationHeight={0}
      heading="Nothing here"
      body="Come back later."
    />
  );
  render(state);
}

describe("<MessageState> fill", () => {
  it("sizes to content by default (no fill wrapper)", () => {
    renderState(false);
    // The content root is the illustration's flex column; without `fill` it is
    // the outermost node this component renders.
    const contentRoot = screen.getByTestId(
      "message-state-illustration",
    ).parentElement;
    expect(contentRoot).not.toHaveClass("flex-1");
  });

  it("wraps in a fill+center container when fill is set", () => {
    renderState(true);
    const contentRoot = screen.getByTestId(
      "message-state-illustration",
    ).parentElement;
    const fillWrapper = contentRoot?.parentElement;
    expect(fillWrapper).toHaveClass(
      "flex",
      "h-full",
      "min-h-0",
      "flex-1",
      "items-center",
      "justify-center",
    );
  });
});

describe("<MessageState> testId", () => {
  it("lands the testId on the content root when not filled", () => {
    render(
      <MessageState
        testId="empty-thing"
        illustrationUrl="data:image/svg+xml,<svg/>"
        illustrationWidth={0}
        illustrationHeight={0}
        heading="Nothing here"
        body="Come back later."
      />,
    );
    // Without `fill`, the content div is the outermost node, so the testId
    // must land there (callers that centered it themselves keyed off this id).
    const node = screen.getByTestId("empty-thing");
    expect(node).toContainElement(
      screen.getByTestId("message-state-illustration"),
    );
    expect(node).not.toHaveClass("flex-1");
  });

  it("lands the testId on the fill wrapper when filled", () => {
    render(
      <MessageState
        fill
        testId="empty-thing"
        illustrationUrl="data:image/svg+xml,<svg/>"
        illustrationWidth={0}
        illustrationHeight={0}
        heading="Nothing here"
        body="Come back later."
      />,
    );
    // With `fill`, the fill+center wrapper is outermost, so the testId lands
    // there — a single node that both centers and carries the caller's hook.
    const node = screen.getByTestId("empty-thing");
    expect(node).toHaveClass(
      "flex",
      "h-full",
      "items-center",
      "justify-center",
    );
  });
});

describe("<MessageState> role", () => {
  it("lands the role on the content root when not filled", () => {
    render(
      <MessageState
        role="alert"
        illustrationUrl="data:image/svg+xml,<svg/>"
        illustrationWidth={0}
        illustrationHeight={0}
        heading="Nothing here"
        body="Come back later."
      />,
    );
    // Without `fill`, the content div is outermost, so the role lands there.
    const node = screen.getByRole("alert");
    expect(node).toContainElement(
      screen.getByTestId("message-state-illustration"),
    );
    expect(node).not.toHaveClass("flex-1");
  });

  it("lands the role on the fill wrapper when filled", () => {
    render(
      <MessageState
        fill
        role="alert"
        illustrationUrl="data:image/svg+xml,<svg/>"
        illustrationWidth={0}
        illustrationHeight={0}
        heading="Nothing here"
        body="Come back later."
      />,
    );
    // With `fill`, the role lands on the fill+center wrapper — the same node
    // that centers, so an error fallback needs no extra wrapper.
    expect(screen.getByRole("alert")).toHaveClass(
      "flex",
      "h-full",
      "items-center",
      "justify-center",
    );
  });
});
