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

import { InputGroupButton } from "@sico/ui";
import { Plus } from "lucide-react";
import { type ChangeEvent, type JSX, useRef } from "react";

type Props = {
  onAddFile: (file: File) => void;
};

// The composer's attach control: a circular `+` trigger wired to a hidden
// file input (Figma 19358:64589).
export function ComposerAttachButton({ onAddFile }: Props): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (file) {
      onAddFile(file);
    }
    // Reset so re-picking the same file fires `change` again.
    input.value = "";
  };

  return (
    <>
      <InputGroupButton
        size="icon-sm"
        className="rounded-full"
        aria-label="Add attachment"
        onClick={() => fileInputRef.current?.click()}
      >
        <Plus />
      </InputGroupButton>
      <input
        ref={fileInputRef}
        type="file"
        aria-label="Attach a file"
        className="sr-only"
        onChange={handleFileChange}
      />
    </>
  );
}
