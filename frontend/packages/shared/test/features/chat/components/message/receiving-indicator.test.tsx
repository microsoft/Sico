import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Part } from "@/features/chat/atoms/chat-atom";
import { ReceivingIndicator } from "@/features/chat/components/message/receiving-indicator";
import { PlanStatusSchema } from "@/features/chat/schemas/plan";

const textPart: Part = { partId: "p1", type: "text", text: "hi" };
const planPart: Part = { partId: "p1", type: "plan", planId: "plan-1" };

describe("ReceivingIndicator", () => {
  it("pending phase: shows a spinner before the stream opens (no Thinking text yet)", () => {
    render(<ReceivingIndicator parts={[]} phase="pending" />);
    // The ↻ window (placeholder created on click, onopen not fired): a spinner,
    // not the Thinking label — that arrives once the stream is actually open.
    expect(
      screen.getByRole("status", { name: /loading/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Thinking…")).not.toBeInTheDocument();
  });

  it("trigger 1: shows Thinking… while the open streaming turn has no part yet", () => {
    render(<ReceivingIndicator parts={[]} phase="streaming" />);
    expect(screen.getByText("Thinking…")).toBeInTheDocument();
  });

  it("trigger 2: shows Thinking… while a plan part's status is still unpolled", () => {
    render(<ReceivingIndicator parts={[planPart]} phase="streaming" />);
    expect(screen.getByText("Thinking…")).toBeInTheDocument();
  });

  it("uses the capitalized copy aligned to legacy (ShinyText 'Thinking')", () => {
    render(<ReceivingIndicator parts={[]} phase="streaming" />);
    expect(screen.getByText("Thinking…")).toBeInTheDocument();
    expect(screen.queryByText("thinking")).not.toBeInTheDocument();
  });

  it("renders nothing when the turn is not receiving (no phase)", () => {
    const { container } = render(<ReceivingIndicator parts={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("clears once the first text part lands (trigger 1 resolved)", () => {
    const { container } = render(
      <ReceivingIndicator parts={[textPart]} phase="streaming" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("clears once the plan poll returns a status (trigger 2 resolved)", () => {
    const { container } = render(
      <ReceivingIndicator
        parts={[planPart]}
        planStatus={PlanStatusSchema.enum.RUNNING}
        phase="streaming"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("animates with the shimmer sweep and uses token classes only — no hardcoded hex", () => {
    const { container } = render(
      <ReceivingIndicator parts={[]} phase="streaming" />,
    );
    const strip = container.firstElementChild;
    expect(strip).toHaveClass("animate-shimmer");
    expect(strip).not.toHaveClass("animate-pulse");
    expect(strip?.className).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(strip?.getAttribute("style") ?? "").not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
