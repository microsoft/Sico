import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AxiosInstance } from "axios";
import { Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AddKnowledgeTagArea } from "@/features/projects/components/add-knowledge-tag-area";
import type { KnowledgeTag } from "@/features/projects/schemas/knowledge-tag";
import * as service from "@/features/projects/services/knowledge-tags";
import { ApiClientProvider } from "@/services/api-client-context";

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

async function renderArea(props: {
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
          <AddKnowledgeTagArea
            projectId={PROJECT_ID}
            value={props.value}
            onChange={props.onChange}
          />
        </Suspense>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
  // Suspense resolves once `fetchKnowledgeTags` settles → the Add tag button renders.
  await screen.findByRole("button", { name: /add tag/i });
  return user;
}

beforeEach(() => {
  vi.mocked(service.fetchKnowledgeTags).mockReset();
  vi.mocked(service.createKnowledgeTag).mockReset();
});

describe("<AddKnowledgeTagArea>", () => {
  it("renders a removable chip for each selected tag", async () => {
    seed([knowledgeTag(1, "Refunds"), knowledgeTag(2, "Onboarding")]);
    const onChange = vi.fn();
    await renderArea({ value: [1, 2], onChange });

    expect(screen.getByText("Refunds")).toBeInTheDocument();
    expect(screen.getByText("Onboarding")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Refunds" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Onboarding" }),
    ).toBeInTheDocument();
  });

  it("removing a chip calls onChange without that id", async () => {
    seed([knowledgeTag(1, "Refunds"), knowledgeTag(2, "Onboarding")]);
    const onChange = vi.fn();
    const user = await renderArea({ value: [1, 2], onChange });

    await user.click(screen.getByRole("button", { name: "Remove Refunds" }));

    expect(onChange).toHaveBeenCalledWith([2]);
  });

  it("renders no chips when value is empty", async () => {
    seed([knowledgeTag(1, "Refunds"), knowledgeTag(2, "Onboarding")]);
    const onChange = vi.fn();
    await renderArea({ value: [], onChange });

    expect(screen.queryByRole("button", { name: /^remove /i })).toBeNull();
    expect(
      screen.getByRole("button", { name: /add tag/i }),
    ).toBeInTheDocument();
  });
});
