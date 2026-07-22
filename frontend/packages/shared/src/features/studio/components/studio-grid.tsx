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

import { type ReactElement } from "react";

import { StudioCard } from "./studio-card";
import { StudioEmpty } from "./studio-empty";
import { CardGrid } from "../../../components/card-grid";
import { useAgentInfosSuspenseQuery } from "../hooks/use-agent-infos-query";

/**
 * Grid of `/studio`. The legacy `single_agent_infos` endpoint returns the full
 * list in one shot (no pagination), so this renders every card at once. Errors
 * are not handled here — the suspense hook throws to the `<ErrorBoundary>`
 * mounted in `<Studio>`.
 */
export function StudioGrid(): ReactElement {
  const { data: agents } = useAgentInfosSuspenseQuery();

  if (agents.length === 0) {
    return <StudioEmpty />;
  }

  return (
    <CardGrid>
      {agents.map((agent) => (
        <StudioCard key={agent.agentId} agent={agent} />
      ))}
    </CardGrid>
  );
}
