import { act, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { type JSX } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  type SidepaneContent,
  sidepaneContentAtom,
} from "@/features/chat/atoms/sidepane-atom";
import { Sidepane } from "@/features/chat/components/sidepane/sidepane";

const MARKDOWN: NonNullable<SidepaneContent> = {
  kind: "markdown",
  title: "T",
  markdown: "# B",
};
const FILE: NonNullable<SidepaneContent> = {
  kind: "file",
  filename: "x.pdf",
  fileUrl: "https://x/x.pdf",
};

// Render a trigger button beside the panel so we can prove focus moves INTO the
// panel on open and RETURNS to the trigger on close. A fresh store per test
// isolates the singleton sidepane atoms; we drive the real closed→open
// transition by setting the content atom AFTER render (the effect keys on that
// transition, so seeding before render wouldn't exercise focus-on-open).
function renderWithTrigger(
  store: ReturnType<typeof createStore>,
): HTMLButtonElement {
  render(
    <Provider store={store}>
      <button type="button">Trigger</button>
      <Sidepane />
    </Provider>,
  );
  return screen.getByRole<HTMLButtonElement>("button", { name: "Trigger" });
}

// act() flushes the state update + passive effects so focus has settled before
// we assert (a bare store.set would also warn about an un-acted update).
function setContent(
  store: ReturnType<typeof createStore>,
  content: SidepaneContent,
): void {
  act(() => {
    store.set(sidepaneContentAtom, content);
  });
}

describe("Sidepane focus management (CE5)", () => {
  // (a) focus-on-open: the closed→open transition moves focus into the panel
  // region itself, so the next Tab lands inside and SRs announce the region.
  it("moves focus into the panel region when it opens", () => {
    const store = createStore();
    const trigger = renderWithTrigger(store);
    trigger.focus();

    setContent(store, MARKDOWN);

    expect(screen.getByRole("region", { name: "Preview panel" })).toHaveFocus();
  });

  // (b) return-on-close: closing returns focus to whatever was focused before
  // open (the trigger), so keyboard users aren't dumped back at the page top.
  it("returns focus to the trigger when it closes", () => {
    const store = createStore();
    const trigger = renderWithTrigger(store);
    trigger.focus();

    setContent(store, MARKDOWN);
    setContent(store, null);

    expect(trigger).toHaveFocus();
  });

  // (c) MP13: a content swap while open keeps isOpen true, so the effect must
  // NOT re-run and re-steal focus. Move focus out of the panel, swap, and assert
  // focus stayed put — this guards deps=[isOpen], not [content].
  it("does not re-steal focus when content swaps while it stays open", () => {
    const store = createStore();
    const trigger = renderWithTrigger(store);
    trigger.focus();

    setContent(store, MARKDOWN);
    // The user moves focus out of the panel (e.g. back to the trigger).
    trigger.focus();

    setContent(store, FILE);

    expect(trigger).toHaveFocus();
  });

  // (d) CE5 robustness: when the trigger is removed from the DOM while the panel
  // is open, the return-focus cleanup must NOT call .focus() on the detached
  // node — the `isConnected` guard (sidepane.tsx) skips it. In jsdom a detached
  // .focus() is a silent no-op, so neither a throw nor document.activeElement can
  // tell the guarded path apart; spying on the captured trigger's focus is the
  // only way to prove the call was skipped (drop the guard and the spy fires).
  it("does not refocus a trigger that was removed while it was open", () => {
    const store = createStore();
    const ui = (showTrigger: boolean): JSX.Element => (
      <Provider store={store}>
        {showTrigger ? <button type="button">Trigger</button> : null}
        <Sidepane />
      </Provider>
    );
    const { rerender } = render(ui(true));
    const trigger = screen.getByRole<HTMLButtonElement>("button", {
      name: "Trigger",
    });

    // Focus the trigger so the open effect captures THIS button (not <body>) as
    // the element to restore; spy AFTER, so the call baseline is zero.
    trigger.focus();
    const focusSpy = vi.spyOn(trigger, "focus");

    setContent(store, MARKDOWN); // open: capture trigger, move focus to region
    rerender(ui(false)); // remove the trigger while the panel is open
    expect(trigger.isConnected).toBe(false); // sanity: captured node is detached
    setContent(store, null); // close: cleanup runs return-focus

    expect(focusSpy).not.toHaveBeenCalled();
  });
});
