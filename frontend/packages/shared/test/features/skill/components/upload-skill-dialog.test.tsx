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
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { UploadSkillDialog } from "@/features/skill/components/dialogs/upload-skill-dialog";

describe("UploadSkillDialog", () => {
  it("rejects an unsupported extension and accepts a valid one", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <UploadSkillDialog
        open
        mode="create"
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const input = screen.getByLabelText("Skill files");

    await user.upload(
      input,
      new File(["x"], "notes.txt", { type: "text/plain" }),
    );
    expect(screen.getByRole("button", { name: /upload/i })).toBeDisabled();

    const md = new File(["# hi"], "skill.md", { type: "text/markdown" });
    await user.upload(input, md);
    const confirm = screen.getByRole("button", { name: /upload/i });
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith([md]);
  });
});
