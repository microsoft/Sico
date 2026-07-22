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
