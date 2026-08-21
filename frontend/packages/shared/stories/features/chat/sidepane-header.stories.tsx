import { Badge, Button } from "@sico/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { createStore, Provider } from "jotai";
import { Download, FileText } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { sidepaneMaximizedAtom } from "@/features/chat/atoms/sidepane-atom";
import { SidepaneHeader } from "@/features/chat/components/sidepane/sidepane-header";

// `SidepaneHeader` reads `useSidepane()`, so every story needs a jotai store.
// `maximized` is seeded into the atom (not a prop) to flip the maximize control
// to its Restore state — hence the composed `StoryArgs` + pinned Docs snippet.
function withSeededStore(maximized: boolean): ReturnType<typeof createStore> {
  const store = createStore();
  store.set(sidepaneMaximizedAtom, maximized);
  return store;
}

type StoryArgs = {
  // Synthetic: seeds `sidepaneMaximizedAtom` so the header shows Maximize vs.
  // Restore — not a real prop.
  maximized: boolean;
  title: string;
  titleSlot?: ReactNode;
  actionsSlot?: ReactNode;
  statusSlot?: ReactNode;
};

const meta: Meta<StoryArgs> = {
  title: "Chat/SidepaneHeader",
  render: ({
    maximized,
    title,
    titleSlot,
    actionsSlot,
    statusSlot,
  }): ReactElement => (
    <Provider store={withSeededStore(maximized)}>
      {/* A panel-width surface so the justify-between header reads with its
          actions hugging the right edge, mirroring the live previewer. */}
      <div className="bg-surface-basic w-180">
        <SidepaneHeader
          icon={FileText}
          title={title}
          titleSlot={titleSlot}
          actionsSlot={actionsSlot}
          statusSlot={statusSlot}
        />
      </div>
    </Provider>
  ),
  parameters: {
    docs: {
      source: {
        code: '<SidepaneHeader icon={FileText} title="My Report" />',
      },
    },
  },
  args: { maximized: false, title: "AI Platform Output Format Research" },
};

export default meta;
type Story = StoryObj<StoryArgs>;

/** Resting state — file-type icon + title on the left, the fixed
 *  maximize and close controls on the right. */
export const Default: Story = {};

/** Seeded `maximized=true` — the maximize control swaps to the Restore glyph
 *  and the "Restore" accessible name. */
export const Maximized: Story = {
  args: { maximized: true },
};

/** `actionsSlot` carries a caller action (here a Download button, as the
 *  markdown previewer supplies) before the fixed maximize/close pair. */
export const WithActions: Story = {
  args: {
    actionsSlot: (
      <Button variant="subtle" size="icon-xs" aria-label="Download">
        <Download className="size-4" />
      </Button>
    ),
  },
};

/** `statusSlot` carries a right-aligned status badge before maximize (D2 drops
 *  a live sandbox status here). */
export const WithStatusSlot: Story = {
  args: {
    statusSlot: <Badge color="green">Completed</Badge>,
  },
};
