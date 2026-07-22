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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Timestamp } from "@/features/chat/components/message/timestamp";

// formatDateTime reads the system clock for its day-tier, so pin "now" to a
// local-time noon (same approach as format-date-time.test). 09:30 today then
// formats to the bare "09:30" the frame shows.
const NOW = new Date("2024-06-15T12:00:00");
const TODAY_0930 = new Date("2024-06-15T09:30:00").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Timestamp", () => {
  it("renders the latest part's time, formatted (today -> HH:mm)", () => {
    render(<Timestamp createdAt={TODAY_0930} />);
    expect(screen.getByText("09:30")).toBeInTheDocument();
  });

  it("renders a semantic <time> with a machine-readable dateTime", () => {
    render(<Timestamp createdAt={TODAY_0930} />);
    const el = screen.getByText("09:30");
    expect(el.tagName).toBe("TIME");
    expect(el).toHaveAttribute("dateTime", new Date(TODAY_0930).toISOString());
  });

  it("renders nothing when there is no timestamp (no renderable part)", () => {
    const { container } = render(<Timestamp />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while the turn is still receiving (streaming)", () => {
    render(<Timestamp createdAt={TODAY_0930} streaming />);
    expect(screen.queryByText("09:30")).not.toBeInTheDocument();
  });

  it("renders nothing while the turn's plan is RUNNING", () => {
    render(<Timestamp createdAt={TODAY_0930} planRunning />);
    expect(screen.queryByText("09:30")).not.toBeInTheDocument();
  });
});
