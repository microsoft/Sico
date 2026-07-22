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

import { cn } from "@sico/ui/lib/utils.ts";
import { type JSX, useEffect, useState } from "react";

import { DwAvatar } from "../../../../components/dw-avatar";
import { type Agent } from "../../../digital-worker/schemas/agent";

type Props = {
  agent: Agent;
};

// Delay before the hero line crossfades from the agent identity to the prompt.
const HERO_SWAP_DELAY_MS = 3000;

// Shared chrome for both stacked lines; only the opacity class differs per line.
const HERO_LINE_CLASS =
  "text-foreground-primary absolute inset-0 flex items-center justify-center text-2xl font-medium transition-opacity duration-500 ease-in-out";

// The DW home hero: the avatar over a single text line that crossfades once —
// "{name}, {role}" → "How can I help you today?" — after a 3s beat (legacy
// parity). Both lines are stacked absolutely so the swap is a pure opacity
// dissolve with no layout shift.
export function DigitalWorkerHomeHero({ agent }: Props): JSX.Element {
  const [swapped, setSwapped] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSwapped(true), HERO_SWAP_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  const identity = agent.role ? `${agent.name}, ${agent.role}` : agent.name;

  return (
    <div className="mb-6 flex flex-col items-center">
      <div className="shadow-avatar-glow-rest hover:shadow-avatar-glow-hover rounded-full transition-shadow duration-300 ease-in-out">
        <DwAvatar agent={agent} size="2xl" decorative />
      </div>
      <div className="relative mt-4 h-8 w-full">
        <p
          className={cn(HERO_LINE_CLASS, swapped ? "opacity-0" : "opacity-100")}
        >
          {identity}
        </p>
        <p
          className={cn(HERO_LINE_CLASS, swapped ? "opacity-100" : "opacity-0")}
        >
          How can I help you today?
        </p>
      </div>
    </div>
  );
}
