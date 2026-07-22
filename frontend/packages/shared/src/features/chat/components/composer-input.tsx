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

import { InputGroupTextarea } from "@sico/ui";
import { type JSX, type KeyboardEvent } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
};

export function ComposerInput({
  value,
  onChange,
  onSubmit,
  disabled,
}: Props): JSX.Element {
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    // IME double guard: skip submit mid-composition (both signals — Safari/
    // older browsers surface 229 instead of isComposing).
    const composing =
      event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
    if (composing) {
      return;
    }
    event.preventDefault();
    onSubmit();
  };

  return (
    <InputGroupTextarea
      aria-label="Message input"
      placeholder="Ask anything ..."
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={handleKeyDown}
      // shadow-none! kills the control's own focus shadow: the base Textarea's
      // focus-visible:shadow-s leaks through (shadow-s is a custom token
      // tailwind-merge can't dedupe against InputGroupTextarea's shadow-none),
      // and the ring-0 box-shadow composite repaints it as an inset highlight
      // line. The card owns the only focus shadow.
      className="text-foreground-primary max-h-90 min-h-12 overflow-y-auto py-0 pr-3 pl-4 text-base focus-visible:shadow-none!"
    />
  );
}
