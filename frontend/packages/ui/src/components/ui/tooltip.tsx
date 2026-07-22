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

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";

import { cn } from "../../lib/utils";

const DEFAULT_DELAY_MS = 400;

/* ─── Provider — shared delay duration ──────────────────────── */

type TooltipProviderProps = {
  children: ReactNode;
  delayDuration?: number;
};

function TooltipProvider({
  children,
  delayDuration = DEFAULT_DELAY_MS,
}: TooltipProviderProps): ReactElement {
  return (
    <TooltipPrimitive.Provider delay={delayDuration}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

/* ─── Root — propagates per-tooltip delay override to Trigger ─ */

type DelayCtxValue = { delay: number };
const DelayCtx = createContext<DelayCtxValue | null>(null);

type TooltipProps = {
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  delayDuration?: number;
};

function Tooltip({
  children,
  open,
  defaultOpen,
  onOpenChange,
  delayDuration,
}: TooltipProps): ReactElement {
  const delayCtx = useMemo<DelayCtxValue | null>(
    () => (delayDuration === undefined ? null : { delay: delayDuration }),
    [delayDuration],
  );

  return (
    <DelayCtx.Provider value={delayCtx}>
      <TooltipPrimitive.Root
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={
          onOpenChange === undefined
            ? undefined
            : (next): void => onOpenChange(next)
        }
      >
        {children}
      </TooltipPrimitive.Root>
    </DelayCtx.Provider>
  );
}

/* ─── Trigger ────────────────────────────────────────────────── */

type TooltipTriggerProps = ComponentPropsWithoutRef<
  typeof TooltipPrimitive.Trigger
>;

function TooltipTrigger({ delay, ...rest }: TooltipTriggerProps): ReactElement {
  const delayCtx = useContext(DelayCtx);
  const effectiveDelay = delay ?? delayCtx?.delay;

  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      {...(effectiveDelay !== undefined ? { delay: effectiveDelay } : {})}
      {...rest}
    />
  );
}

/* ─── Content ────────────────────────────────────────────────── */

type Side = "top" | "right" | "bottom" | "left";
type Align = "start" | "center" | "end";

type TooltipContentProps = {
  children: ReactNode;
  side?: Side;
  align?: Align;
  sideOffset?: number;
  showArrow?: boolean;
  className?: string;
};

function TooltipContent({
  children,
  side = "top",
  align = "center",
  sideOffset = 8,
  showArrow = true,
  className,
}: TooltipContentProps): ReactElement {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          role="tooltip"
          data-slot="tooltip-content"
          className={cn(
            "bg-surface-inverted text-foreground-on-inverted shadow-m relative z-50 max-w-64 rounded-lg px-3 py-2 text-sm text-balance",
            className,
          )}
        >
          {children}
          {showArrow ? (
            <TooltipPrimitive.Arrow
              data-slot="tooltip-arrow"
              className={cn(
                "bg-surface-inverted absolute size-2 rotate-45",
                "data-[side=top]:-bottom-1",
                "data-[side=bottom]:-top-1",
                "data-[side=left]:-right-1",
                "data-[side=right]:-left-1",
              )}
            />
          ) : null}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  type TooltipContentProps,
  type TooltipProps,
  type TooltipProviderProps,
  type TooltipTriggerProps,
};
