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

import { AgentInfoPopover } from "@/features/digital-worker/components/agent-info-popover";
import { type Agent } from "@/features/digital-worker/schemas/agent";

// operatorUsername (the assigned operator) and employerUsername (the owner) are
// DISTINCT backend fields; the fixture sets them apart so a test can prove the
// "Operator" row reads the former, not the latter (the migration bug).
const makeAgent = (overrides: Partial<Agent> = {}): Agent => ({
  id: 1,
  name: "MAXweb",
  role: "Tester",
  operatorUsername: "operator-alice",
  employerUsername: "owner-bob",
  project: { id: 2, name: "Demo" },
  ...overrides,
});

describe("<AgentInfoPopover>", () => {
  it("shows the operator's username in the Operator row", () => {
    render(<AgentInfoPopover agent={makeAgent()} />);
    expect(screen.getByText("operator-alice")).toBeInTheDocument();
  });

  it("does not show the employer's username as the Operator", () => {
    render(<AgentInfoPopover agent={makeAgent()} />);
    expect(screen.queryByText("owner-bob")).not.toBeInTheDocument();
  });

  it("omits the Operator row when operatorUsername is absent", () => {
    render(
      <AgentInfoPopover agent={makeAgent({ operatorUsername: undefined })} />,
    );
    expect(screen.queryByText("Operator")).not.toBeInTheDocument();
  });

  it("shows the project name in the Project row", () => {
    render(<AgentInfoPopover agent={makeAgent()} />);
    expect(screen.getByText("Demo")).toBeInTheDocument();
  });
});
