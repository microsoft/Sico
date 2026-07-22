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

import { render, type RenderResult, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ProjectDrawer } from "@/features/projects/components/project-drawer";
import type { KnowledgeTag } from "@/features/projects/schemas/knowledge-tag";
import {
  MemberTypeSchema,
  type ProjectDetail,
} from "@/features/projects/schemas/project";

function makeProject(partial: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: 1,
    name: "E-commerce Platform",
    description: "A short project summary.",
    iconUrl: "",
    memberType: MemberTypeSchema.enum.OWNER,
    agentInstances: [
      { id: 1, iconUrl: "" },
      { id: 2, iconUrl: "" },
    ],
    ownerUsername: "owner@microsoft.com",
    creatorUsername: "amy@microsoft.com",
    operatorAdmins: ["jessica@microsoft.com", "michael@microsoft.com"],
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

function makeKnowledgeTag(partial: Partial<KnowledgeTag> = {}): KnowledgeTag {
  return {
    id: 1,
    projectId: 1,
    name: "Knowledge tag",
    description: "",
    creatorUsername: "amy@microsoft.com",
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

type Props = Parameters<typeof ProjectDrawer>[0];

type Setup = RenderResult & { props: Required<Props>; user: UserEvent };

function setup(overrides: Partial<Props> = {}): Setup {
  const props: Required<Props> = {
    project: makeProject(),
    knowledgeTags: [],
    onEditProject: vi.fn(),
    onViewAllKnowledgeTags: vi.fn(),
    onRemoveOperator: vi.fn(),
    onToggleCollapse: vi.fn(),
    ...overrides,
  };
  const user = userEvent.setup();
  const result = render(
    <ProjectDrawer
      project={props.project}
      knowledgeTags={props.knowledgeTags}
      onEditProject={props.onEditProject}
      onViewAllKnowledgeTags={props.onViewAllKnowledgeTags}
      onRemoveOperator={props.onRemoveOperator}
      onToggleCollapse={props.onToggleCollapse}
    />,
  );
  return { ...result, props, user };
}

describe("ProjectDrawer", () => {
  it("renders the creator line, the Digital workers title and member count", () => {
    setup({
      project: makeProject({
        creatorUsername: "amy@microsoft.com",
        agentInstances: [
          { id: 1, iconUrl: "" },
          { id: 2, iconUrl: "" },
          { id: 3, iconUrl: "" },
        ],
      }),
    });
    expect(
      screen.getByText("Created by amy@microsoft.com"),
    ).toBeInTheDocument();
    // Figma 19456-11635: a "Digital workers" title with the avatars + count
    // inline, the count reading "{n} members".
    expect(screen.getByText("Digital workers")).toBeInTheDocument();
    expect(screen.getByText("3 members")).toBeInTheDocument();
  });

  it("omits the Operators section entirely when there are no operators", () => {
    setup({ project: makeProject({ operatorAdmins: [] }) });

    // No lone "Operators" heading (and its leading divider) when the list is empty.
    expect(screen.queryByText("Operators")).toBeNull();
    // The rest of the panel still renders.
    expect(screen.getByText("Digital workers")).toBeInTheDocument();
  });

  it("hides edit and operator controls for a plain member", () => {
    setup({
      project: makeProject({
        memberType: MemberTypeSchema.enum.MEMBER,
        operatorAdmins: ["jess@microsoft.com"],
      }),
    });
    expect(
      screen.queryByRole("button", { name: "Edit project" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Actions for/ }),
    ).not.toBeInTheDocument();
  });

  it("treats memberType 0 (Go zero-value) as read-only — no edit/operator controls", () => {
    setup({
      project: makeProject({
        memberType: 0,
        operatorAdmins: ["jess@microsoft.com"],
      }),
    });
    expect(
      screen.queryByRole("button", { name: "Edit project" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Actions for/ }),
    ).not.toBeInTheDocument();
  });

  it("shows edit and operator controls for an owner", () => {
    setup({
      project: makeProject({
        memberType: MemberTypeSchema.enum.OWNER,
        operatorAdmins: ["jess@microsoft.com"],
      }),
    });
    expect(
      screen.getByRole("button", { name: "Edit project" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Actions for jess@microsoft.com" }),
    ).toBeInTheDocument();
  });

  it("shows edit and operator controls for an admin", () => {
    setup({
      project: makeProject({
        memberType: MemberTypeSchema.enum.ADMIN,
        operatorAdmins: ["jess@microsoft.com"],
      }),
    });
    expect(
      screen.getByRole("button", { name: "Edit project" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Actions for jess@microsoft.com" }),
    ).toBeInTheDocument();
  });

  it("reveals Remove in the operator menu", async () => {
    const { user } = setup({
      project: makeProject({ operatorAdmins: ["jess@microsoft.com"] }),
    });
    await user.click(
      screen.getByRole("button", { name: "Actions for jess@microsoft.com" }),
    );
    expect(
      await screen.findByRole("menuitem", { name: "Remove" }),
    ).toBeInTheDocument();
  });

  it("shows View all only when knowledge tags exceed three", () => {
    const many = [1, 2, 3, 4].map((n) =>
      makeKnowledgeTag({ id: n, name: `Knowledge tag ${n}` }),
    );
    const { unmount } = setup({ knowledgeTags: many });
    expect(
      screen.getByRole("button", { name: "View all" }),
    ).toBeInTheDocument();
    unmount();
    setup({ knowledgeTags: many.slice(0, 3) });
    expect(
      screen.queryByRole("button", { name: "View all" }),
    ).not.toBeInTheDocument();
  });

  it("calls onEditProject when the edit control is clicked", async () => {
    const { props, user } = setup({
      project: makeProject({ memberType: MemberTypeSchema.enum.OWNER }),
    });
    await user.click(screen.getByRole("button", { name: "Edit project" }));
    expect(props.onEditProject).toHaveBeenCalledTimes(1);
  });

  it("raises view-all and remove-operator with the operator's name", async () => {
    const many = [1, 2, 3, 4].map((n) =>
      makeKnowledgeTag({ id: n, name: `Knowledge tag ${n}` }),
    );
    const { props, user } = setup({
      knowledgeTags: many,
      project: makeProject({ operatorAdmins: ["jess@microsoft.com"] }),
    });
    await user.click(screen.getByRole("button", { name: "View all" }));
    expect(props.onViewAllKnowledgeTags).toHaveBeenCalledTimes(1);
    await user.click(
      screen.getByRole("button", { name: "Actions for jess@microsoft.com" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Remove" }));
    expect(props.onRemoveOperator).toHaveBeenCalledWith("jess@microsoft.com");
  });
});
