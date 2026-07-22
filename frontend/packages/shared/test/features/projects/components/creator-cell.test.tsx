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

import { CreatorCell } from "@/features/projects/components/creator-cell";

describe("<CreatorCell>", () => {
  it("renders the username beside a user avatar for a user creator", () => {
    render(<CreatorCell creator={{ kind: "user", username: "alice" }} />);

    expect(screen.getByText("alice")).toBeInTheDocument();
    // Both avatars render a `data-testid="avatar-root"` root.
    expect(screen.getByTestId("avatar-root")).toBeInTheDocument();
  });

  it("falls back to the 'Digital worker' label when an agent creator has no name", () => {
    render(<CreatorCell creator={{ kind: "agent", agentInstanceId: 7 }} />);

    // Missing name (older rows) → the cell still names the creator with the
    // generic label beside a decorative avatar, never a blank cell.
    expect(screen.getByText("Digital worker")).toBeInTheDocument();
    expect(screen.getByTestId("avatar-root")).toBeInTheDocument();
  });

  it("renders the agentName beside a DW avatar when the wire carries it", () => {
    render(
      <CreatorCell
        creator={{
          kind: "agent",
          agentInstanceId: 7,
          agentName: "Max",
          iconUrl: "/icons/max.svg",
        }}
      />,
    );

    // The name rides on extraInfo.agentInstance → visible text beside a
    // decorative avatar (mirrors the user branch), not the generic label.
    expect(screen.getByText("Max")).toBeInTheDocument();
    expect(screen.getByTestId("avatar-root")).toBeInTheDocument();
    expect(screen.queryByText("Digital worker")).not.toBeInTheDocument();
  });
});
