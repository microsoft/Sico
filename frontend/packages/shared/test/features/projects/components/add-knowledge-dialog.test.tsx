import { toast } from "@sico/ui";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AddKnowledgeDialog } from "@/features/projects/components/add-knowledge-dialog";
import { useAddKnowledgeMutation } from "@/features/projects/hooks/use-add-knowledge-mutation";

vi.mock("@sico/ui", async (importActual) => {
  const actual = await importActual<typeof import("@sico/ui")>();
  return { ...actual, toast: { success: vi.fn(), error: vi.fn() } };
});

vi.mock("@/features/projects/hooks/use-add-knowledge-mutation", () => ({
  useAddKnowledgeMutation: vi.fn(),
}));

// Mock the suspending tag area: render the current value (so persistence is assertable)
// and expose a button that adds tag id 1.
vi.mock("@/features/projects/components/add-knowledge-tag-area", () => ({
  AddKnowledgeTagArea: ({
    value,
    onChange,
  }: {
    value: number[];
    onChange: (next: number[]) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onChange([...value, 1])}>
        mock add tag
      </button>
      <span data-testid="selected-tags">{value.join(",")}</span>
    </div>
  ),
}));

const mockedHook = vi.mocked(useAddKnowledgeMutation);

function mockMutation(
  overrides: Partial<ReturnType<typeof useAddKnowledgeMutation>> = {},
): ReturnType<typeof useAddKnowledgeMutation> {
  return {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    ...overrides,
  } as unknown as ReturnType<typeof useAddKnowledgeMutation>;
}

function pdf(name: string, bytes = 1024): File {
  return new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedHook.mockReturnValue(mockMutation());
});

describe("AddKnowledgeDialog", () => {
  it("rejects an oversize file with the oversize toast", async () => {
    const user = userEvent.setup();
    render(<AddKnowledgeDialog projectId={7} open onOpenChange={vi.fn()} />);

    await user.upload(
      screen.getByTestId("add-knowledge-file-input"),
      pdf("big.pdf", 11 * 1024 * 1024),
    );

    expect(toast.error).toHaveBeenCalledWith(
      '"big.pdf" is larger than 10MB. Try a smaller file.',
    );
  });

  it("rejects the 6th file with the count toast", async () => {
    const user = userEvent.setup();
    render(<AddKnowledgeDialog projectId={7} open onOpenChange={vi.fn()} />);

    await user.upload(screen.getByTestId("add-knowledge-file-input"), [
      pdf("a.pdf"),
      pdf("b.pdf"),
      pdf("c.pdf"),
      pdf("d.pdf"),
      pdf("e.pdf"),
      pdf("f.pdf"),
    ]);

    expect(toast.error).toHaveBeenCalledWith(
      "You can add up to 5 files at a time. Remove one to add another.",
    );
  });

  it("rejects a wrong-type file with the wrongType toast", () => {
    render(<AddKnowledgeDialog projectId={7} open onOpenChange={vi.fn()} />);

    // Wrong type is filtered by userEvent.upload's `accept` honoring, so use
    // fireEvent to bypass and exercise the dialog's own validation gate.
    fireEvent.change(screen.getByTestId("add-knowledge-file-input"), {
      target: {
        files: [
          new File([new Uint8Array(8)], "notes.txt", { type: "text/plain" }),
        ],
      },
    });

    expect(toast.error).toHaveBeenCalledWith(
      '"notes.txt" isn\'t a supported type. Use pdf, docx, or xlsx.',
    );
  });

  it("uploads valid files via the mutation and toasts uploaded", async () => {
    const mutate = vi.fn((_input, opts) =>
      opts?.onSuccess?.({ succeeded: ["a.pdf"], failed: [] }),
    );
    mockedHook.mockReturnValue(mockMutation({ mutate }));
    const user = userEvent.setup();
    render(<AddKnowledgeDialog projectId={7} open onOpenChange={vi.fn()} />);

    await user.upload(
      screen.getByTestId("add-knowledge-file-input"),
      pdf("a.pdf"),
    );
    await user.click(screen.getByRole("button", { name: "Upload" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const [input] = mutate.mock.calls[0] as [
      { files: File[]; links: string[]; tagIds: number[] },
      unknown,
    ];
    expect(input.files).toHaveLength(1);
    const [submitted] = input.files;
    expect(submitted).toBeInstanceOf(File);
    expect(submitted?.name).toBe("a.pdf");
    expect(input.links).toEqual([]);
    expect(input.tagIds).toEqual([]);
    expect(toast.success).toHaveBeenCalledWith(
      "Knowledge uploaded — extracting…",
    );
  });

  it("enables Upload with a link and no file, and submits the link", async () => {
    const mutate = vi.fn((_input, opts) =>
      opts?.onSuccess?.({ succeeded: ["https://example.com/a"], failed: [] }),
    );
    mockedHook.mockReturnValue(mockMutation({ mutate }));
    const user = userEvent.setup();
    render(<AddKnowledgeDialog projectId={7} open onOpenChange={vi.fn()} />);

    await user.type(
      screen.getByRole("textbox", { name: /import from link/i }),
      "https://example.com/a",
    );
    await user.click(screen.getByRole("button", { name: "Add" }));

    const upload = screen.getByRole("button", { name: "Upload" });
    expect(upload).toBeEnabled();
    await user.click(upload);

    expect(mutate).toHaveBeenCalledTimes(1);
    const [input] = mutate.mock.calls[0] as [
      { files: File[]; links: string[]; tagIds: number[] },
      unknown,
    ];
    expect(input.files).toEqual([]);
    expect(input.links).toEqual(["https://example.com/a"]);
  });

  it("rejects a javascript: link with a toast and adds nothing (XSS gate)", async () => {
    mockedHook.mockReturnValue(mockMutation({}));
    const user = userEvent.setup();
    render(<AddKnowledgeDialog projectId={7} open onOpenChange={vi.fn()} />);

    await user.type(
      screen.getByRole("textbox", { name: /import from link/i }),
      // eslint-disable-next-line no-script-url -- the exact XSS payload under test
      "javascript:alert(1)",
    );
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(toast.error).toHaveBeenCalledWith("Enter a valid http(s) link.");
    // Upload stays disabled — nothing was added to the link list.
    expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();
  });

  it("ignores a duplicate link so it is added only once", async () => {
    const mutate = vi.fn((_input, opts) =>
      opts?.onSuccess?.({ succeeded: ["https://example.com/a"], failed: [] }),
    );
    mockedHook.mockReturnValue(mockMutation({ mutate }));
    const user = userEvent.setup();
    render(<AddKnowledgeDialog projectId={7} open onOpenChange={vi.fn()} />);

    const linkInput = screen.getByRole("textbox", {
      name: /import from link/i,
    });
    const addButton = screen.getByRole("button", { name: "Add" });
    await user.type(linkInput, "https://example.com/a");
    await user.click(addButton);
    await user.type(linkInput, "https://example.com/a");
    await user.click(addButton);

    await user.click(screen.getByRole("button", { name: "Upload" }));

    const [input] = mutate.mock.calls[0] as [
      { files: File[]; links: string[]; tagIds: number[] },
      unknown,
    ];
    expect(input.links).toEqual(["https://example.com/a"]);
  });

  it("submits the selected tag ids alongside the files", async () => {
    const mutate = vi.fn((_input, opts) =>
      opts?.onSuccess?.({ succeeded: ["a.pdf"], failed: [] }),
    );
    mockedHook.mockReturnValue(mockMutation({ mutate }));
    const user = userEvent.setup();
    render(<AddKnowledgeDialog projectId={7} open onOpenChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /mock add tag/i }));
    await user.upload(
      screen.getByTestId("add-knowledge-file-input"),
      pdf("a.pdf"),
    );
    await user.click(screen.getByRole("button", { name: "Upload" }));

    const [input] = mutate.mock.calls[0] as [
      { files: File[]; links: string[]; tagIds: number[] },
      unknown,
    ];
    expect(input.tagIds).toEqual([1]);
  });

  it("keeps the dialog open and toasts the failure when every file fails", async () => {
    const onOpenChange = vi.fn();
    const mutate = vi.fn((_input, opts) =>
      opts?.onSuccess?.({ succeeded: [], failed: ["a.pdf"] }),
    );
    mockedHook.mockReturnValue(mockMutation({ mutate }));
    const user = userEvent.setup();
    render(
      <AddKnowledgeDialog projectId={7} open onOpenChange={onOpenChange} />,
    );

    await user.upload(
      screen.getByTestId("add-knowledge-file-input"),
      pdf("a.pdf"),
    );
    await user.click(screen.getByRole("button", { name: "Upload" }));

    expect(toast.error).toHaveBeenCalledWith(
      "Some items couldn't be added. Try again.",
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("clears selected tag chips after Cancel and reopen", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <AddKnowledgeDialog projectId={7} open onOpenChange={onOpenChange} />,
    );
    await user.click(screen.getByRole("button", { name: /mock add tag/i }));
    expect(screen.getByTestId("selected-tags")).toHaveTextContent("1");
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    rerender(
      <AddKnowledgeDialog
        projectId={7}
        open={false}
        onOpenChange={onOpenChange}
      />,
    );
    rerender(
      <AddKnowledgeDialog projectId={7} open onOpenChange={onOpenChange} />,
    );
    // Closing resets every draft field, tags included — a reopened dialog is clean.
    expect(screen.getByTestId("selected-tags")).toHaveTextContent("");
  });
});
