import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider as JotaiProvider } from "jotai";
import { type PropsWithChildren, type ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { sidepaneContentAtom } from "@/features/chat/atoms/sidepane-atom";
import { Deliverable } from "@/features/chat/components/cards/plan-card/deliverable";

function withStore(
  store: ReturnType<typeof createStore>,
): (props: PropsWithChildren) => ReactElement {
  function Wrapper({ children }: PropsWithChildren): ReactElement {
    return <JotaiProvider store={store}>{children}</JotaiProvider>;
  }

  return Wrapper;
}

// Wire ToolDeliverable shapes (plan.proto types): MARKDOWN=1, FILE=2,
// WEB_PAGE_PREVIEW_URL=3. The store keeps these `unknown`, so the chip narrows
// them itself — the test feeds the raw wire objects.
const fileDeliverable = { type: 2, fileName: "report.pdf" };
const markdownDeliverable = { type: 1, markdownTitle: "Summary" };
const previewDeliverable = { type: 3, webPreviewSasUrl: "https://x/p" };
const sandboxDeliverable = { type: 5, sandboxId: "sb-1" };

describe("Deliverable", () => {
  it("renders a FILE deliverable as a chip showing its fileName", () => {
    render(<Deliverable deliverables={[fileDeliverable]} />);
    expect(screen.getByText("report.pdf")).toBeInTheDocument();
  });

  it("shows a pointer cursor on the clickable chip", () => {
    render(<Deliverable deliverables={[fileDeliverable]} />);
    expect(screen.getByRole("button", { name: /report\.pdf/ })).toHaveClass(
      "cursor-pointer",
    );
  });

  it("renders a MARKDOWN deliverable as a chip showing its markdownTitle", () => {
    render(<Deliverable deliverables={[markdownDeliverable]} />);
    expect(screen.getByText("Summary")).toBeInTheDocument();
  });

  it("labels a WEB_PAGE_PREVIEW_URL deliverable 'Preview Page'", () => {
    render(<Deliverable deliverables={[previewDeliverable]} />);
    expect(screen.getByText("Preview Page")).toBeInTheDocument();
  });

  it("drops non-renderable deliverable types (e.g. sandbox)", () => {
    const { container } = render(
      <Deliverable deliverables={[sandboxDeliverable]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a chip per renderable deliverable, dropping the rest", () => {
    render(
      <Deliverable
        deliverables={[
          fileDeliverable,
          sandboxDeliverable,
          markdownDeliverable,
        ]}
      />,
    );
    expect(screen.getByText("report.pdf")).toBeInTheDocument();
    expect(screen.getByText("Summary")).toBeInTheDocument();
  });

  it("renders nothing when there are no deliverables", () => {
    const { container } = render(<Deliverable deliverables={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("ignores malformed entries that are not objects", () => {
    const { container } = render(
      <Deliverable deliverables={[null, "x", 42]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("styles the chip per Figma 15184-42530: rounded-lg + foreground-primary text", () => {
    render(<Deliverable deliverables={[fileDeliverable]} />);
    // The chip is the label span's parent (the pill container).
    const chip = screen.getByText("report.pdf").parentElement;
    expect(chip).toHaveClass("rounded-lg"); // Figma rounded-8, not rounded-xl
    expect(chip).toHaveClass("text-foreground-primary"); // Figma primary/2 #2d3339
  });

  it("uses token classes only — no hardcoded hex", () => {
    const { container } = render(
      <Deliverable deliverables={[fileDeliverable, previewDeliverable]} />,
    );
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  // --- click-to-open the sidepane (D1 un-park) -------------------------------

  it("opens markdown content in the sidepane when a markdown chip is clicked", async () => {
    const store = createStore();
    const user = userEvent.setup();
    render(<Deliverable deliverables={[markdownDeliverable]} />, {
      wrapper: withStore(store),
    });
    await user.click(screen.getByRole("button", { name: /Summary/ }));
    expect(store.get(sidepaneContentAtom)).toEqual({
      kind: "markdown",
      title: "Summary",
      markdown: "",
    });
  });

  it("opens webpage content in the sidepane when a preview chip is clicked", async () => {
    const store = createStore();
    const user = userEvent.setup();
    render(<Deliverable deliverables={[previewDeliverable]} />, {
      wrapper: withStore(store),
    });
    await user.click(screen.getByRole("button", { name: /Preview Page/ }));
    expect(store.get(sidepaneContentAtom)).toEqual({
      kind: "webpage",
      url: "https://x/p",
    });
  });

  it("opens file content in the sidepane when a file chip is clicked", async () => {
    const store = createStore();
    const user = userEvent.setup();
    render(<Deliverable deliverables={[fileDeliverable]} />, {
      wrapper: withStore(store),
    });
    await user.click(screen.getByRole("button", { name: /report\.pdf/ }));
    expect(store.get(sidepaneContentAtom)).toEqual({
      kind: "file",
      filename: "report.pdf",
      fileUrl: "",
      fileUri: "",
      // A deliverable file can be published to the project.
      canAddToProject: true,
    });
  });

  it("opens the sidepane on keyboard activation (Enter)", async () => {
    const store = createStore();
    const user = userEvent.setup();
    render(<Deliverable deliverables={[markdownDeliverable]} />, {
      wrapper: withStore(store),
    });
    await user.tab();
    await user.keyboard("{Enter}");
    expect(store.get(sidepaneContentAtom)).toEqual({
      kind: "markdown",
      title: "Summary",
      markdown: "",
    });
  });
});
