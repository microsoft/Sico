import { toast } from "@sico/ui";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAgentsQuery } from "@/features/digital-worker/hooks/use-agents-query";
import { type Agent } from "@/features/digital-worker/schemas/agent";
import { AssignDeviceDialog } from "@/features/sandbox-devices/components/assign-device-dialog";
import { useAssignDeviceMutation } from "@/features/sandbox-devices/hooks/use-assign-device-mutation";
import { type Device } from "@/features/sandbox-devices/schemas/device";

vi.mock("@sico/ui", async (importActual) => {
  const actual = await importActual<typeof import("@sico/ui")>();
  return { ...actual, toast: { success: vi.fn(), error: vi.fn() } };
});

vi.mock("@/features/sandbox-devices/hooks/use-assign-device-mutation", () => ({
  useAssignDeviceMutation: vi.fn(),
}));

// Only the query hook is mocked; `useDedupedAgents` stays real and flattens the
// mocked pages, so the dialog's real page→agent selection path is exercised.
vi.mock("@/features/digital-worker/hooks/use-agents-query", async (imp) => {
  const actual =
    await imp<
      typeof import("@/features/digital-worker/hooks/use-agents-query")
    >();
  return { ...actual, useAgentsQuery: vi.fn() };
});

const mockedUseAssignDeviceMutation = vi.mocked(useAssignDeviceMutation);
const mockedUseAgents = vi.mocked(useAgentsQuery);

function mockMutation(
  overrides: Partial<ReturnType<typeof useAssignDeviceMutation>> = {},
): ReturnType<typeof useAssignDeviceMutation> {
  return {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    ...overrides,
  } as unknown as ReturnType<typeof useAssignDeviceMutation>;
}

const AGENTS: Agent[] = [
  { id: 11, name: "Analyst DW" },
  { id: 22, name: "Support DW" },
];

// The infinite-query shape the dialog consumes: one page of `agents`, no next
// page, settled. `useDedupedAgents` flattens `data.pages` downstream.
function mockAgentsQuery(
  overrides: Record<string, unknown> = {},
): ReturnType<typeof useAgentsQuery> {
  return {
    data: { pages: [{ items: AGENTS, total: AGENTS.length, hasNext: false }] },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    isPending: false,
    isError: false,
    ...overrides,
  } as unknown as ReturnType<typeof useAgentsQuery>;
}

function makeDevice(partial: Partial<Device> = {}): Device {
  return {
    sandboxId: "sbx-1",
    displayName: "Device One",
    type: "emulator",
    status: "available",
    projectId: 7,
    instanceId: 0,
    instanceName: "",
    vncUrl: "",
    ...partial,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedUseAssignDeviceMutation.mockReturnValue(mockMutation());
  mockedUseAgents.mockReturnValue(mockAgentsQuery());
});

describe("AssignDeviceDialog", () => {
  it("blocks submit with a validation error when no worker is selected", async () => {
    const mutate = vi.fn();
    mockedUseAssignDeviceMutation.mockReturnValue(mockMutation({ mutate }));
    const user = userEvent.setup();
    render(
      <AssignDeviceDialog
        open
        onOpenChange={vi.fn()}
        projectId={7}
        device={makeDevice()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Assign" }));

    expect(
      await screen.findByText("Pick a digital worker"),
    ).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("assigns the selected worker to the device's sandbox", async () => {
    const mutate = vi.fn();
    mockedUseAssignDeviceMutation.mockReturnValue(mockMutation({ mutate }));
    const user = userEvent.setup();
    render(
      <AssignDeviceDialog
        open
        onOpenChange={vi.fn()}
        projectId={7}
        device={makeDevice({ sandboxId: "sbx-9" })}
      />,
    );

    await user.click(screen.getByLabelText("Digital Worker"));
    await user.click(await screen.findByRole("option", { name: "Support DW" }));
    await user.click(screen.getByRole("button", { name: "Assign" }));

    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith(
        { instanceId: "22", sandboxId: "sbx-9" },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      ),
    );
  });

  it("shows the worker's name (not its id) on the trigger once selected", async () => {
    mockedUseAssignDeviceMutation.mockReturnValue(mockMutation({}));
    const user = userEvent.setup();
    render(
      <AssignDeviceDialog
        open
        onOpenChange={vi.fn()}
        projectId={7}
        device={makeDevice({ sandboxId: "sbx-9" })}
      />,
    );

    await user.click(screen.getByLabelText("Digital Worker"));
    await user.click(await screen.findByRole("option", { name: "Support DW" }));

    // Base UI's <SelectValue> resolves the label from the `items` map; without
    // it the trigger would echo the raw value ("22").
    expect(screen.getByLabelText("Digital Worker")).toHaveTextContent(
      "Support DW",
    );
  });

  it("toasts (not inline) when the workers fail to load", async () => {
    mockedUseAgents.mockReturnValue(
      mockAgentsQuery({ data: undefined, isPending: false, isError: true }),
    );
    render(
      <AssignDeviceDialog
        open
        onOpenChange={vi.fn()}
        projectId={7}
        device={makeDevice()}
      />,
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("load digital workers"),
      ),
    );
  });
});
