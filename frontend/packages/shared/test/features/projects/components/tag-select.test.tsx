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

import { toast } from "@sico/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AxiosInstance } from "axios";
import { Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TagSelect } from "@/features/projects/components/tag-select";
import type { KnowledgeTag } from "@/features/projects/schemas/knowledge-tag";
import * as service from "@/features/projects/services/knowledge-tags";
import { ApiClientProvider } from "@/services/api-client-context";

vi.mock("@sico/ui", async (importActual) => {
  const actual = await importActual<typeof import("@sico/ui")>();
  return { ...actual, toast: { success: vi.fn(), error: vi.fn() } };
});

vi.mock("@/features/projects/services/knowledge-tags");

const PROJECT_ID = 7;

function knowledgeTag(id: number, name: string): KnowledgeTag {
  return {
    id,
    projectId: PROJECT_ID,
    name,
    description: "",
    creatorUsername: "alice",
    createdAt: 1,
    updatedAt: 2,
  };
}

function seed(items: KnowledgeTag[]): void {
  vi.mocked(service.fetchKnowledgeTags).mockResolvedValue({
    items,
    total: items.length,
    hasNext: false,
  });
}

async function openMenu(props: {
  value: number[];
  onChange: (next: number[]) => void;
}): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  const apiClient = {} as AxiosInstance;
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={apiClient}>
        <Suspense fallback={null}>
          <TagSelect
            projectId={PROJECT_ID}
            value={props.value}
            onChange={props.onChange}
          />
        </Suspense>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
  // Suspense resolves once `fetchKnowledgeTags` settles → trigger renders.
  const trigger = await screen.findByRole("button", { name: /add tag/i });
  await user.click(trigger);
  await screen.findByRole("menu");
  return user;
}

beforeEach(() => {
  vi.mocked(service.fetchKnowledgeTags).mockReset();
  vi.mocked(service.createKnowledgeTag).mockReset();
});

describe("<TagSelect>", () => {
  it("toggling an unchecked tag adds its id and keeps the menu open", async () => {
    seed([knowledgeTag(1, "Refunds"), knowledgeTag(2, "Onboarding")]);
    const onChange = vi.fn();
    const user = await openMenu({ value: [], onChange });

    await user.click(
      screen.getByRole("menuitemcheckbox", { name: /refunds/i }),
    );

    expect(onChange).toHaveBeenCalledWith([1]);
    // Base UI checkbox items stay open on click — the menu must NOT close.
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("toggling a checked tag removes its id (immutably)", async () => {
    seed([knowledgeTag(1, "Refunds"), knowledgeTag(2, "Onboarding")]);
    const onChange = vi.fn();
    const user = await openMenu({ value: [1, 2], onChange });

    await user.click(
      screen.getByRole("menuitemcheckbox", { name: /refunds/i }),
    );

    expect(onChange).toHaveBeenCalledWith([2]);
  });

  it("'+ Create new tag' swaps to an inline input without closing the menu", async () => {
    seed([knowledgeTag(1, "Refunds")]);
    const onChange = vi.fn();
    const user = await openMenu({ value: [], onChange });

    await user.click(screen.getByRole("menuitem", { name: /create new tag/i }));

    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /create new tag/i }),
    ).toBeNull();
  });

  it("typing a name + Enter creates the tag and auto-checks the new id", async () => {
    seed([knowledgeTag(1, "Refunds")]);
    vi.mocked(service.createKnowledgeTag).mockResolvedValue(99);
    const onChange = vi.fn();
    const user = await openMenu({ value: [], onChange });

    await user.click(screen.getByRole("menuitem", { name: /create new tag/i }));
    await user.type(screen.getByRole("textbox"), "Billing{Enter}");

    await waitFor(() =>
      expect(service.createKnowledgeTag).toHaveBeenCalledWith(
        expect.anything(),
        {
          projectId: PROJECT_ID,
          name: "Billing",
          description: "",
        },
      ),
    );
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([99]));
  });

  it("toasts and keeps the typed name when tag creation fails", async () => {
    seed([knowledgeTag(1, "Refunds")]);
    vi.mocked(service.createKnowledgeTag).mockRejectedValue(new Error("nope"));
    const onChange = vi.fn();
    const user = await openMenu({ value: [], onChange });

    await user.click(screen.getByRole("menuitem", { name: /create new tag/i }));
    await user.type(screen.getByRole("textbox"), "Billing{Enter}");

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "We couldn't create the tag. Try again.",
      ),
    );
    // The input stays open with the typed name preserved for retry.
    expect(screen.getByRole("textbox")).toHaveValue("Billing");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders the 'Create new tag' row with the link accent token", async () => {
    seed([knowledgeTag(1, "Refunds")]);
    const onChange = vi.fn();
    await openMenu({ value: [], onChange });

    expect(
      screen.getByRole("menuitem", { name: /create new tag/i }),
    ).toHaveClass("text-foreground-link-rest");
  });

  it("renders 'No tags yet.' when the source is empty", async () => {
    seed([]);
    const onChange = vi.fn();
    await openMenu({ value: [], onChange });

    expect(screen.getByText(/no tags yet\./i)).toBeInTheDocument();
    expect(screen.queryByRole("menuitemcheckbox")).toBeNull();
  });

  it("has no text-filter input in the default (non-creating) state", async () => {
    seed([knowledgeTag(1, "Refunds"), knowledgeTag(2, "Onboarding")]);
    const onChange = vi.fn();
    await openMenu({ value: [], onChange });

    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
