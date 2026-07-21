import { toast } from "@sico/ui";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EditKnowledgeTagDialog } from "@/features/projects/components/edit-knowledge-tag-dialog";
import { useKnowledgeTagMutation } from "@/features/projects/hooks/use-knowledge-tag-mutation";
import type { KnowledgeTag } from "@/features/projects/schemas/knowledge-tag";

vi.mock("@sico/ui", async (importActual) => {
  const actual = await importActual<typeof import("@sico/ui")>();
  return { ...actual, toast: { success: vi.fn(), error: vi.fn() } };
});

vi.mock("@/features/projects/hooks/use-knowledge-tag-mutation", () => ({
  useKnowledgeTagMutation: vi.fn(),
}));

const mockedUseKnowledgeTagMutation = vi.mocked(useKnowledgeTagMutation);

type Mutation = ReturnType<typeof useKnowledgeTagMutation>["create"];

function mockMutation(overrides: Partial<Mutation> = {}): Mutation {
  return {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    ...overrides,
  } as unknown as Mutation;
}

function mockHook(create: Mutation, edit: Mutation): void {
  mockedUseKnowledgeTagMutation.mockReturnValue({
    create,
    edit,
    remove: mockMutation(),
  } as unknown as ReturnType<typeof useKnowledgeTagMutation>);
}

function makeKnowledgeTag(partial: Partial<KnowledgeTag> = {}): KnowledgeTag {
  return {
    id: 5,
    projectId: 7,
    name: "Refund flow",
    description: "Use when handling refunds.",
    creatorUsername: "alice@microsoft.com",
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHook(mockMutation(), mockMutation());
});

describe("EditKnowledgeTagDialog", () => {
  it("renders empty fields in Add mode", () => {
    render(
      <EditKnowledgeTagDialog open projectId={7} onOpenChange={vi.fn()} />,
    );

    expect(screen.getByText("Add knowledge tag")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.getByLabelText("When to use")).toHaveValue("");
  });

  it("pre-fills both fields from the knowledge tag in Edit mode", () => {
    render(
      <EditKnowledgeTagDialog
        open
        projectId={7}
        knowledgeTag={makeKnowledgeTag()}
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Edit knowledge tag")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Refund flow");
    expect(screen.getByLabelText("When to use")).toHaveValue(
      "Use when handling refunds.",
    );
  });

  it("updates the live character counters as the user types", async () => {
    const user = userEvent.setup();
    render(
      <EditKnowledgeTagDialog open projectId={7} onOpenChange={vi.fn()} />,
    );

    expect(screen.getByText("0/20")).toBeInTheDocument();
    expect(screen.getByText("0/100")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Name"), "Hello");
    expect(screen.getByText("5/20")).toBeInTheDocument();

    await user.type(screen.getByLabelText("When to use"), "Hey");
    expect(screen.getByText("3/100")).toBeInTheDocument();
  });

  it("hard-caps Name input at 20 characters", async () => {
    const user = userEvent.setup();
    render(
      <EditKnowledgeTagDialog open projectId={7} onOpenChange={vi.fn()} />,
    );

    await user.click(screen.getByLabelText("Name"));
    await user.paste("a".repeat(21));

    expect(screen.getByLabelText("Name")).toHaveValue("a".repeat(20));
    expect(screen.getByText("20/20")).toBeInTheDocument();
  });

  it("hard-caps When to use input at 100 characters", async () => {
    const user = userEvent.setup();
    render(
      <EditKnowledgeTagDialog open projectId={7} onOpenChange={vi.fn()} />,
    );

    await user.click(screen.getByLabelText("When to use"));
    await user.paste("b".repeat(101));

    expect(screen.getByLabelText("When to use")).toHaveValue("b".repeat(100));
    expect(screen.getByText("100/100")).toBeInTheDocument();
  });

  it("creates, toasts, and closes on a valid Add submit", async () => {
    const mutate = vi.fn((_vars, opts) => opts?.onSuccess?.(1));
    const onOpenChange = vi.fn();
    mockHook(mockMutation({ mutate }), mockMutation());
    const user = userEvent.setup();
    render(
      <EditKnowledgeTagDialog open projectId={7} onOpenChange={onOpenChange} />,
    );

    await user.type(screen.getByLabelText("Name"), "Refunds");
    await user.type(screen.getByLabelText("When to use"), "Use for refunds");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 7,
          name: "Refunds",
          description: "Use for refunds",
        }),
        expect.anything(),
      ),
    );
    expect(toast.success).toHaveBeenCalledWith("Knowledge tag saved.", {
      invert: true,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("edits with the knowledge tag id on a valid Edit submit", async () => {
    const mutate = vi.fn((_vars, opts) => opts?.onSuccess?.(5));
    mockHook(mockMutation(), mockMutation({ mutate }));
    const user = userEvent.setup();
    render(
      <EditKnowledgeTagDialog
        open
        projectId={7}
        knowledgeTag={makeKnowledgeTag()}
        onOpenChange={vi.fn()}
      />,
    );

    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Renamed");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 5,
          name: "Renamed",
          description: "Use when handling refunds.",
        }),
        expect.anything(),
      ),
    );
  });
});
