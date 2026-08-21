import type { Meta, StoryObj } from "@storybook/react-vite";
import { createStore, Provider } from "jotai";
import type { ReactElement } from "react";

import {
  type SidepaneContent,
  sidepaneContentAtom,
  sidepaneMaximizedAtom,
} from "@/features/chat/atoms/sidepane-atom";
import { Sidepane } from "@/features/chat/components/sidepane/sidepane";

// A markdown doc rich enough that the dispatched MarkdownPreviewer shows its
// heading scale + prose, so the shell's panel geometry reads against real body.
const RICH_MARKDOWN = `# Target Audience Research

Digital Workers land hardest where work is repetitive, cognition can be
automated, and labour cost pressure is high.

## Core audience traits

- **Smart manufacturing** — scheduling and approval flows with heavy repetition.
- **Professional services** — finance and consulting teams drowning in documents.
`;

// The shell reads `useSidepane()`, so every story seeds a fresh jotai store —
// `content` drives open/closed + which previewer mounts, `maximized` the frame.
function renderShell(
  content: NonNullable<SidepaneContent>,
  maximized = false,
): ReactElement {
  const store = createStore();
  store.set(sidepaneContentAtom, content);
  store.set(sidepaneMaximizedAtom, maximized);
  return (
    <Provider store={store}>
      {/* A chat-row-sized frame so the inline `w-3/4` panel reads as the live
          right-push (the empty quarter is where the chat column sits). */}
      <div className="bg-surface-sunken flex h-150 w-full justify-end">
        <Sidepane />
      </div>
    </Provider>
  );
}

const meta = {
  title: "Chat/Sidepane",
  component: Sidepane,
} satisfies Meta<typeof Sidepane>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Open at ~75% width (the inline right-push frame) dispatching markdown content
 *  through the registry to the MarkdownPreviewer. */
export const MarkdownOpen: Story = {
  render: () =>
    renderShell({
      kind: "markdown",
      title: "AI Platform Output Format Research",
      markdown: RICH_MARKDOWN,
    }),
};

/** Maximized — the panel goes full-viewport (`fixed inset-0`), covering the chat
 *  column entirely (MP5). */
export const Maximized: Story = {
  render: () =>
    renderShell(
      {
        kind: "markdown",
        title: "AI Platform Output Format Research",
        markdown: RICH_MARKDOWN,
      },
      true,
    ),
};
