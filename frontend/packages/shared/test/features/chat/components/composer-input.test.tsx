import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ComposerInput } from "@/features/chat/components/composer-input";

describe("ComposerInput", () => {
  it("calls onChange as the user types", async () => {
    const onChange = vi.fn();
    render(<ComposerInput value="" onChange={onChange} onSubmit={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Message input"), "hi");
    expect(onChange).toHaveBeenCalled();
  });

  it("submits on Enter when not composing", async () => {
    const onSubmit = vi.fn();
    render(<ComposerInput value="hi" onChange={vi.fn()} onSubmit={onSubmit} />);
    const input = screen.getByLabelText("Message input");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("does NOT submit on Shift+Enter (newline)", async () => {
    const onSubmit = vi.fn();
    render(<ComposerInput value="hi" onChange={vi.fn()} onSubmit={onSubmit} />);
    screen.getByLabelText("Message input").focus();
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does NOT submit on Enter while IME composing", () => {
    const onSubmit = vi.fn();
    render(<ComposerInput value="あ" onChange={vi.fn()} onSubmit={onSubmit} />);
    const input = screen.getByLabelText("Message input");
    // Simulate a composing Enter (isComposing true). Set it via the
    // KeyboardEvent init dict: isComposing is a getter-only prop, so
    // Object.assign-ing it onto a constructed event throws "only has a
    // getter" in both jsdom and real browsers.
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        isComposing: true,
      }),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
