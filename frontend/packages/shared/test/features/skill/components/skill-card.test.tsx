import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";

import { SkillCard } from "@/features/skill/components/skill-list/skill-card";
import type { SkillFile } from "@/features/skill/schemas/skill";
import { SkillStatusSchema } from "@/features/skill/schemas/skill";

// CodeMirror can't render in jsdom (it needs layout APIs like getClientRects).
// Mock CodeViewer down to a controlled element so these tests exercise the
// card's own edit/save wiring rather than CodeMirror's DOM. The mock mirrors
// CodeViewer's real accessible name (`edit|view {path}`) so label-based queries
// match the production contract.
vi.mock("@/features/skill/components/file-explorer/code-viewer", () => ({
  CodeViewer: ({
    file,
    editable,
    onChange,
  }: {
    file: SkillFile;
    editable: boolean;
    onChange?: (content: string) => void;
  }): React.ReactElement =>
    editable ? (
      <textarea
        aria-label={`edit ${file.path}`}
        value={file.content}
        onChange={(event) => onChange?.(event.target.value)}
      />
    ) : (
      <div>{file.content}</div>
    ),
}));

const baseSkill = {
  id: 1,
  agentId: "a",
  name: "Visual Bot",
  description: "",
  version: "v1",
  status: 2,
  assetId: 1,
  creatorUsername: "max",
  failReason: "",
  projectId: 1,
  createdAt: 1,
  updatedAt: "2",
} as const;

const version = {
  id: 10,
  skillId: 1,
  version: "v1",
  name: "Visual Bot",
  description: "",
  assetId: 1,
  url: "",
  creatorUsername: "max",
  failReason: "",
  createdAt: 1,
  updatedAt: 2,
  files: [{ path: "skill.md", content: "# hi" }],
  actions: [{ name: "search", description: "d", advancedSettings: "" }],
};

function renderCard(
  overrides: Partial<React.ComponentProps<typeof SkillCard>> = {},
): React.ComponentProps<typeof SkillCard> {
  const props = {
    skill: baseSkill,
    versions: [version],
    status: SkillStatusSchema.enum.UPLOADED,
    detailLoading: false,
    originalFiles: version.files,
    filesLoading: false,
    selectedVersion: "v1",
    onSelectVersion: vi.fn(),
    onReplace: vi.fn(),
    onDownloadZip: vi.fn(),
    onDelete: vi.fn(),
    onSave: vi.fn().mockResolvedValue(undefined),
    expanded: false,
    onToggle: vi.fn(),
    ...overrides,
  };
  render(React.createElement(StatefulCard, props));
  return props;
}

function StatefulCard(
  props: React.ComponentProps<typeof SkillCard>,
): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false);
  return React.createElement(SkillCard, {
    ...props,
    expanded,
    onToggle: () => setExpanded((prev) => !prev),
  });
}

describe("SkillCard", () => {
  it("shows the parsing placeholder while uploading", () => {
    renderCard({ status: SkillStatusSchema.enum.UPLOADING });
    screen.getByText(/parsing skill content/i);
  });

  it("shows the parse-failed reason when failed", () => {
    renderCard({
      status: SkillStatusSchema.enum.FAILED,
      skill: { ...baseSkill, failReason: "bad zip" },
    });
    screen.getByText("bad zip");
  });

  it("renders Files and Tools tabs once expanded", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("button", { name: /visual bot/i }));
    screen.getByRole("tab", { name: /files/i });
    screen.getByRole("tab", { name: /tools/i });
    expect(screen.getByLabelText(/edit skill\.md/i)).toHaveValue("# hi");
  });

  it("enables Save after an edit and saves the dirty files", async () => {
    const user = userEvent.setup();
    const props = renderCard();
    await user.click(screen.getByRole("button", { name: /visual bot/i }));
    await user.type(screen.getByLabelText(/edit skill\.md/i), "!");
    const save = screen.getByRole("button", { name: /^save$/i });
    expect(save).toBeEnabled();
    await user.click(save);
    expect(props.onSave).toHaveBeenCalledWith({
      files: [{ path: "skill.md", content: "# hi!" }],
      actions: undefined,
    });
  });
});
