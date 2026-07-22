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

import { FailureAnalyzedLabel } from "@/features/chat/components/cards/plan-card/failure-analyzed-label";
import { ToolCallStatusSchema } from "@/features/chat/schemas/plan";

// The auto-hide rides a 5 s setTimeout, so the clock is faked (same pattern as
// timestamp.test). Each test starts from a fresh fake clock.
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("FailureAnalyzedLabel", () => {
  it("renders 'Failure Analyzed.' while a failure is being analyzed", () => {
    render(
      <FailureAnalyzedLabel
        status={ToolCallStatusSchema.enum.FAILED_ANALYZING}
      />,
    );
    expect(screen.getByText("Failure Analyzed.")).toBeInTheDocument();
  });

  it("renders 'Failure Analyzed.' once a failure has been analyzed", () => {
    render(
      <FailureAnalyzedLabel
        status={ToolCallStatusSchema.enum.FAILED_ANALYZED}
      />,
    );
    expect(screen.getByText("Failure Analyzed.")).toBeInTheDocument();
  });

  it("auto-hides 'Failure Analyzed.' after 5 s while streaming", () => {
    render(
      <FailureAnalyzedLabel
        status={ToolCallStatusSchema.enum.FAILED_ANALYZED}
        streaming
      />,
    );
    expect(screen.getByText("Failure Analyzed.")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByText("Failure Analyzed.")).not.toBeInTheDocument();
  });

  it("keeps 'Failure Analyzed.' visible in history (not streaming)", () => {
    render(
      <FailureAnalyzedLabel
        status={ToolCallStatusSchema.enum.FAILED_ANALYZED}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText("Failure Analyzed.")).toBeInTheDocument();
  });

  it("renders the retry-success label for RETRY_SUCCESSFUL", () => {
    render(
      <FailureAnalyzedLabel
        status={ToolCallStatusSchema.enum.RETRY_SUCCESSFUL}
      />,
    );
    expect(
      screen.getByText("Analysis Verified. New experience saved."),
    ).toBeInTheDocument();
  });

  it("does not auto-hide the retry-success label while streaming", () => {
    render(
      <FailureAnalyzedLabel
        status={ToolCallStatusSchema.enum.RETRY_SUCCESSFUL}
        streaming
      />,
    );
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(
      screen.getByText("Analysis Verified. New experience saved."),
    ).toBeInTheDocument();
  });

  it("renders nothing for an unrelated status", () => {
    const { container } = render(
      <FailureAnalyzedLabel status={ToolCallStatusSchema.enum.SUCCESSFUL} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("uses token classes only — no hardcoded hex", () => {
    const { container } = render(
      <FailureAnalyzedLabel
        status={ToolCallStatusSchema.enum.FAILED_ANALYZED}
      />,
    );
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
