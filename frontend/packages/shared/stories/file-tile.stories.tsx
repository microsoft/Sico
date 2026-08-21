import type { Meta, StoryObj } from "@storybook/react-vite";

import { FileTile } from "@/components/file-tile";

const meta = {
  title: "Components/FileTile",
  component: FileTile,
  tags: ["autodocs"],
  args: {
    filename: "quarterly-report.pdf",
    status: "ready",
    onRemove: () => {},
  },
} satisfies Meta<typeof FileTile>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Resting state — the glyph is derived from the filename's extension; the
 *  remove pill is revealed on hover / focus-within. */
export const Ready: Story = {};

/** Upload in flight — the glyph is replaced by a spinner regardless of type. */
export const Loading: Story = {
  args: { status: "loading" },
};

/** The full extension → glyph matrix, mirroring the Figma `AttachmentIcon`
 *  variant set: pdf/md → file, docx → file-description, spreadsheet → table,
 *  code → file-code, url → tabler-world. */
export const FileTypes: Story = {
  render: (args) => (
    <div className="flex flex-col gap-2">
      <FileTile filename="quarterly-report.pdf" onRemove={args.onRemove} />
      <FileTile filename="notes.md" onRemove={args.onRemove} />
      <FileTile filename="contract.docx" onRemove={args.onRemove} />
      <FileTile filename="budget.xlsx" onRemove={args.onRemove} />
      <FileTile filename="main.ts" onRemove={args.onRemove} />
      <FileTile filename="reference.url" onRemove={args.onRemove} />
    </div>
  ),
};

/** A long filename truncates to a single line with an ellipsis; `select-none`
 *  keeps a click from selection-scrolling the hidden tail into view. */
export const LongFilename: Story = {
  args: {
    filename: "a-very-long-attachment-filename-that-wraps-onto-two-lines.pdf",
  },
};
