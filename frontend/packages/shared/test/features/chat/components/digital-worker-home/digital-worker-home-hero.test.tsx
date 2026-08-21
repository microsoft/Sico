import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DigitalWorkerHomeHero } from "@/features/chat/components/digital-worker-home/digital-worker-home-hero";
import { type Agent } from "@/features/digital-worker/schemas/agent";

const makeAgent = (overrides: Partial<Agent> = {}): Agent => ({
  id: 685,
  name: "Arena",
  role: "Tester",
  iconUri: "https://example.com/a.png",
  ...overrides,
});

describe("DigitalWorkerHomeHero", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the agent identity line before the swap", () => {
    render(<DigitalWorkerHomeHero agent={makeAgent()} />);
    expect(screen.getByText("Arena, Tester")).toBeVisible();
  });

  it("renders the name alone when the agent has no role", () => {
    render(<DigitalWorkerHomeHero agent={makeAgent({ role: undefined })} />);
    expect(screen.getByText("Arena")).toBeInTheDocument();
  });

  it("keeps the prompt line mounted but hidden before the swap", () => {
    render(<DigitalWorkerHomeHero agent={makeAgent()} />);
    expect(screen.getByText("How can I help you today?")).toHaveClass(
      "opacity-0",
    );
  });

  it("crossfades the identity line out after the 3s beat", () => {
    render(<DigitalWorkerHomeHero agent={makeAgent()} />);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText("Arena, Tester")).toHaveClass("opacity-0");
  });

  it("crossfades the prompt line in after the 3s beat", () => {
    render(<DigitalWorkerHomeHero agent={makeAgent()} />);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText("How can I help you today?")).toHaveClass(
      "opacity-100",
    );
  });
});
