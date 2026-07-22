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

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ToolCallSubTaskSummary } from "@/features/chat/components/cards/plan-card/tool-call-subtask-summary";

describe("ToolCallSubTaskSummary", () => {
  it("renders the passed roll-up as '{passed}/{total} passed.'", () => {
    render(
      <ToolCallSubTaskSummary passed={3} failed={1} pending={2} total={6} />,
    );
    expect(screen.getByText("3/6 passed.")).toBeInTheDocument();
  });

  it("renders the failed roll-up as '{failed}/{total} failed.'", () => {
    render(
      <ToolCallSubTaskSummary passed={3} failed={1} pending={2} total={6} />,
    );
    expect(screen.getByText("1/6 failed.")).toBeInTheDocument();
  });

  it("renders the pending roll-up as '{pending}/{total} pending.' when pending > 0", () => {
    render(
      <ToolCallSubTaskSummary passed={3} failed={1} pending={2} total={6} />,
    );
    expect(screen.getByText("2/6 pending.")).toBeInTheDocument();
  });

  it("omits the pending roll-up entirely when pending is 0", () => {
    render(
      <ToolCallSubTaskSummary passed={3} failed={1} pending={0} total={4} />,
    );
    expect(screen.queryByText(/pending\./)).not.toBeInTheDocument();
  });

  it("uses token classes only — no hardcoded hex", () => {
    const { container } = render(
      <ToolCallSubTaskSummary passed={3} failed={1} pending={2} total={6} />,
    );
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
