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

import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@sico/ui";
import { Loader2 } from "lucide-react";
import type * as React from "react";
import { memo } from "react";

export type ConfirmDialogProps = {
  /** Visibility is consumer-owned — passed straight to the `<Dialog>` root. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Heading copy (e.g. "Delete Knowledge") → `DialogTitle`. */
  title: string;
  /** Supporting copy → `DialogDescription`. */
  body: string;
  /** Fires when the user confirms; the dialog does NOT self-close. */
  onConfirm: () => void;
  /** While true the destructive action shows a spinner and disables. */
  pending?: boolean;
};

/**
 * Reusable destructive-confirm dialog (design.md §5 `confirm.delete`) — the
 * single confirm reused by asset delete, knowledge-tag delete, and the
 * detail-panel delete. Built on the `@sico/ui` `Dialog` primitives; `title`
 * and `body` are supplied by the consumer rather than hardcoded.
 *
 * Visibility is fully consumer-controlled: `open`/`onOpenChange` pass straight
 * to the `<Dialog>` root, Cancel closes via `DialogClose`, and `onConfirm`
 * only signals intent — the consumer closes the dialog on mutation success.
 */
function ConfirmDialogImpl({
  open,
  onOpenChange,
  title,
  body,
  onConfirm,
  pending = false,
}: ConfirmDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="primary" />}>
            Cancel
          </DialogClose>
          <Button
            variant="destructive-outline"
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? <Loader2 className="animate-spin" /> : null}
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const ConfirmDialog = memo(ConfirmDialogImpl);
