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

import type { ComponentProps } from "react";

import { cn } from "../../lib/utils";

/* ============================================
   Table
   ============================================ */

function Table({
  className,
  ...props
}: ComponentProps<"table">): React.ReactElement {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-base", className)}
        {...props}
      />
    </div>
  );
}

/* ============================================
   TableHeader
   ============================================ */

function TableHeader({
  className,
  ...props
}: ComponentProps<"thead">): React.ReactElement {
  return (
    <thead
      data-slot="table-header"
      // No hover-neutralizing rule needed: TableRow scopes its hover/expanded/
      // selected brand fills to `[tbody_&]`, so header rows never pick them up in
      // the first place. The thead therefore stays whatever its resting fill is
      // (transparent by default, or a sticky consumer's own opaque fill) even on
      // hover — no show-through, no forced background here.
      className={cn("border-divider border-b", className)}
      {...props}
    />
  );
}

/* ============================================
   TableBody
   ============================================ */

function TableBody({
  className,
  ...props
}: ComponentProps<"tbody">): React.ReactElement {
  return <tbody data-slot="table-body" className={cn(className)} {...props} />;
}

/* ============================================
   TableFooter
   ============================================ */

function TableFooter({
  className,
  ...props
}: ComponentProps<"tfoot">): React.ReactElement {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn("bg-muted border-t font-medium", className)}
      {...props}
    />
  );
}

/* ============================================
   TableRow
   ============================================ */

function TableRow({
  className,
  ...props
}: ComponentProps<"tr">): React.ReactElement {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "h-14 transition-colors",
        // Interactive-state fills are scoped to body rows via `[tbody_&]`: a
        // header (thead) or footer (tfoot) row is not data, so it must not pick
        // up the hover/expanded/selected brand tint. Scoping at the source means
        // a sticky header never goes transparent on hover (nothing to neutralize),
        // so the thead needs no counter-rule or opaque fill of its own.
        "[tbody_&]:hover:bg-primary-50",
        "[tbody_&]:has-aria-expanded:bg-primary-50",
        "[tbody_&]:data-[state=selected]:bg-primary-50",
        className,
      )}
      {...props}
    />
  );
}

/* ============================================
   TableHead
   ============================================ */

function TableHead({
  className,
  ...props
}: ComponentProps<"th">): React.ReactElement {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "text-foreground-tertiary h-10 max-w-80 min-w-16 px-4 text-left align-middle text-xs font-medium tracking-wide uppercase",
        "[&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

/* ============================================
   TableCell
   ============================================ */

function TableCell({
  className,
  ...props
}: ComponentProps<"td">): React.ReactElement {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "max-w-80 min-w-16 px-4 align-middle",
        "[&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

/* ============================================
   TableCaption
   ============================================ */

function TableCaption({
  className,
  ...props
}: ComponentProps<"caption">): React.ReactElement {
  return (
    <caption
      data-slot="table-caption"
      className={cn("text-muted-foreground mt-4 text-sm", className)}
      {...props}
    />
  );
}

/* ============================================
   Exports
   ============================================ */

export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
};
