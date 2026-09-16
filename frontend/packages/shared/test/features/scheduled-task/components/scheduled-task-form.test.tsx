import { i18n } from "@lingui/core";
import { toast } from "@sico/ui";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { userAtom } from "@/atoms/auth-atom";
import { ScheduledTaskForm } from "@/features/scheduled-task/components/scheduled-task-form";
import { type ScheduledTask } from "@/features/scheduled-task/schemas/scheduled-task";
import { EnvelopeError } from "@/schemas/api";

const {
  mockAgentsQuery,
  mockAgentQuery,
  mockDedupedAgents,
  mockCreateMutation,
  mockUpdateMutation,
  mockAttachments,
  mockMutate,
  mockReset,
} = vi.hoisted(() => ({
  mockAgentsQuery: vi.fn(),
  mockAgentQuery: vi.fn(),
  mockDedupedAgents: vi.fn(),
  mockCreateMutation: vi.fn(),
  mockUpdateMutation: vi.fn(),
  mockAttachments: vi.fn(),
  mockMutate: vi.fn(),
  mockReset: vi.fn(),
}));

vi.mock("@/features/digital-worker/hooks/use-agents-query", () => ({
  useAgentsQuery: mockAgentsQuery,
  useAgentQuery: mockAgentQuery,
  useDedupedAgents: mockDedupedAgents,
}));

vi.mock("@/features/scheduled-task/hooks/use-scheduled-task-mutations", () => ({
  useCreateScheduledTaskMutation: mockCreateMutation,
  useUpdateScheduledTaskMutation: mockUpdateMutation,
}));

vi.mock(
  "@/features/scheduled-task/hooks/use-scheduled-task-attachments",
  () => ({ useScheduledTaskAttachments: mockAttachments }),
);

function task(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    agentInstanceId: 8,
    attachments: [],
    createdAt: 1,
    creatorUsername: "alex",
    cronExpression: "0 9 * * *",
    enabled: true,
    id: 4,
    lastRunAt: 0,
    message: "Run the report",
    name: "Daily report",
    nextRunAt: 2,
    timezone: "America/New_York",
    updatedAt: 3,
    ...overrides,
  };
}

function setWorkers(...workers: { id: number; name: string }[]): void {
  mockDedupedAgents.mockReturnValue(workers);
}

function withCurrentUser(ui: ReactElement): ReactElement {
  const store = createStore();
  store.set(userAtom, { id: 7, email: "operator@sico.ai", roles: [] });
  return <Provider store={store}>{ui}</Provider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  setWorkers({ id: 8, name: "Reporting Worker" });
  mockAgentsQuery.mockReturnValue({
    data: { pages: [{ items: [{ id: 8, name: "Reporting Worker" }] }] },
    fetchNextPage: vi.fn().mockResolvedValue(undefined),
    hasNextPage: false,
    isError: false,
    isFetchingNextPage: false,
    isPending: false,
  });
  mockAgentQuery.mockReturnValue({ data: undefined });
  mockAttachments.mockReturnValue({
    addFile: vi.fn(),
    anyUploading: false,
    attachments: [],
    fileError: null,
    readyAttachments: [],
    removeAttachment: vi.fn(),
    reset: mockReset,
  });
  const mutation = { isPending: false, mutate: mockMutate };
  mockCreateMutation.mockReturnValue(mutation);
  mockUpdateMutation.mockReturnValue(mutation);
});

describe("<ScheduledTaskForm>", () => {
  it("scopes the worker roster to the current operator", () => {
    render(
      withCurrentUser(
        <ScheduledTaskForm onCancel={vi.fn()} onSuccess={vi.fn()} />,
      ),
    );

    for (const [params] of mockAgentsQuery.mock.calls) {
      expect(params).toEqual({ operatorUsername: "operator@sico.ai" });
    }
  });

  it("connects the visible Instructions label to the task instruction textarea", () => {
    render(<ScheduledTaskForm onCancel={vi.fn()} onSuccess={vi.fn()} />);

    expect(screen.getByLabelText("Instruction")).toHaveAttribute(
      "id",
      "scheduled-task-instruction",
    );
  });

  it("places the accessible Advanced settings checkbox after the schedule fields", () => {
    render(<ScheduledTaskForm onCancel={vi.fn()} onSuccess={vi.fn()} />);

    const heading = screen.getByRole("heading", { name: "Advanced settings" });
    const checkbox = screen.getByRole("checkbox", {
      name: "Notify me by email when completed",
    });
    expect(screen.getByTestId("scheduled-task-schedule-fields")).toAppearBefore(
      heading,
    );
    expect(heading).toAppearBefore(checkbox);
  });

  it("toggles the email preference from its visible label", async () => {
    const user = userEvent.setup();
    render(<ScheduledTaskForm onCancel={vi.fn()} onSuccess={vi.fn()} />);
    const checkbox = screen.getByRole("checkbox", {
      name: "Notify me by email when completed",
    });

    await user.click(screen.getByText("Notify me by email when completed"));

    expect(checkbox).toBeChecked();
  });

  it("limits the email preference hit area to its contents", () => {
    render(<ScheduledTaskForm onCancel={vi.fn()} onSuccess={vi.fn()} />);
    const checkbox = screen.getByRole("checkbox", {
      name: "Notify me by email when completed",
    });

    expect(checkbox.parentElement).toHaveClass("w-fit");
  });

  it("defaults the create email preference to unchecked", () => {
    render(<ScheduledTaskForm onCancel={vi.fn()} onSuccess={vi.fn()} />);

    expect(
      screen.getByRole("checkbox", {
        name: "Notify me by email when completed",
      }),
    ).not.toBeChecked();
  });

  it("reflects a checked edit email preference", () => {
    render(
      <ScheduledTaskForm
        task={task({ extraInfo: { sendEmailOnComplete: true } })}
        onCancel={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("checkbox", {
        name: "Notify me by email when completed",
      }),
    ).toBeChecked();
  });

  it("defaults a legacy edit email preference to unchecked", () => {
    render(
      <ScheduledTaskForm
        task={task()}
        onCancel={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("checkbox", {
        name: "Notify me by email when completed",
      }),
    ).not.toBeChecked();
  });

  it("keeps long create and edit forms scrollable inside the fixed dialog", () => {
    render(<ScheduledTaskForm onCancel={vi.fn()} onSuccess={vi.fn()} />);

    expect(screen.getByLabelText("Task name").closest("form")).toHaveClass(
      "flex",
      "h-full",
      "min-h-0",
      "flex-col",
    );
    expect(screen.getByTestId("scheduled-task-form-scroll")).toHaveClass(
      "min-h-0",
      "flex-1",
      "overflow-y-auto",
    );
  });

  it("orders task name, instructions, and Digital Worker as designed", () => {
    render(<ScheduledTaskForm onCancel={vi.fn()} onSuccess={vi.fn()} />);

    const name = screen.getByLabelText("Task name");
    const instructions = screen.getByLabelText("Instruction");
    const worker = screen.getByLabelText("Digital Worker");
    expect(name).toAppearBefore(instructions);
    expect(instructions).toAppearBefore(worker);
    expect(
      screen.getByTestId("scheduled-task-instruction-shell"),
    ).toContainElement(worker);
  });

  it("shows required errors and invalid state after an empty submission", async () => {
    const user = userEvent.setup();
    render(<ScheduledTaskForm onCancel={vi.fn()} onSuccess={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Enter a task name")).toBeVisible();
    expect(screen.getByLabelText("Instruction")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText("Digital Worker")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("renders forty-eight locale-formatted half-hour choices", async () => {
    const user = userEvent.setup();
    render(
      <ScheduledTaskForm
        task={task()}
        onCancel={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Time" }));

    expect(await screen.findAllByRole("option")).toHaveLength(48);
    await screen.findByRole("option", { name: "00:00 AM" });
    await screen.findByRole("option", { name: "00:30 AM" });
    await screen.findByRole("option", { name: "12:00 PM" });
    await screen.findByRole("option", { name: "11:30 PM" });
  });

  it.each([
    ["00:00 AM", "0 0 * * *"],
    ["00:30 AM", "30 0 * * *"],
  ])(
    "submits %s without changing its midnight cron value",
    async (label, cron) => {
      const user = userEvent.setup();
      render(<ScheduledTaskForm onCancel={vi.fn()} onSuccess={vi.fn()} />);

      await user.type(screen.getByLabelText("Task name"), "Midnight report");
      await user.type(screen.getByLabelText("Instruction"), "Send the report");
      await user.click(
        screen.getByRole("combobox", { name: "Digital Worker" }),
      );
      await user.click(
        await screen.findByRole("option", { name: "Reporting Worker" }),
      );
      await user.click(screen.getByRole("combobox", { name: "Time" }));
      await user.click(await screen.findByRole("option", { name: label }));
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({ cronExpression: cron }),
        expect.anything(),
      );
    },
  );

  it("keeps zh-CN midnight labels locale-native", async () => {
    const user = userEvent.setup();
    i18n.load("zh-CN", { "scheduledTask.form.time.label": "时间" });
    render(<ScheduledTaskForm onCancel={vi.fn()} onSuccess={vi.fn()} />);

    try {
      act(() => i18n.activate("zh-CN"));
      await user.click(screen.getByRole("combobox", { name: "时间" }));
      await screen.findByRole("option", { name: "0:00" });
      await screen.findByRole("option", { name: "0:30" });
    } finally {
      act(() => i18n.activate("en"));
    }
  });

  it("submits a checked email preference in the exact create input", async () => {
    const user = userEvent.setup();
    const timezone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    render(<ScheduledTaskForm onCancel={vi.fn()} onSuccess={vi.fn()} />);

    await user.type(screen.getByLabelText("Task name"), "Afternoon report");
    await user.type(screen.getByLabelText("Instruction"), "Send the report");
    await user.click(screen.getByRole("combobox", { name: "Digital Worker" }));
    await user.click(
      await screen.findByRole("option", { name: "Reporting Worker" }),
    );
    await user.click(screen.getByRole("combobox", { name: "Time" }));
    await user.click(await screen.findByRole("option", { name: "2:30 PM" }));
    await user.click(
      screen.getByRole("checkbox", {
        name: "Notify me by email when completed",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(mockMutate).toHaveBeenCalledWith(
      {
        agentInstanceId: 8,
        attachments: [],
        cronExpression: "30 14 * * *",
        enabled: true,
        extraInfo: { sendEmailOnComplete: true },
        message: "Send the report",
        name: "Afternoon report",
        timezone,
      },
      expect.anything(),
    );
  });

  it("rerenders schedule labels when the active locale changes", async () => {
    const user = userEvent.setup();
    i18n.load("de", {
      "scheduledTask.form.frequency.label": "Wiederholung",
      "scheduledTask.form.frequency.weekly": "Wöchentlich",
      "scheduledTask.form.time.label": "Zeit",
      "scheduledTask.form.weekday.label": "Wochentag",
    });
    render(<ScheduledTaskForm onCancel={vi.fn()} onSuccess={vi.fn()} />);

    try {
      act(() => i18n.activate("de"));
      await waitFor(() =>
        expect(
          screen.getByRole("combobox", { name: "Wiederholung" }),
        ).toBeVisible(),
      );
      expect(screen.getByRole("combobox", { name: "Zeit" })).toBeVisible();
      await user.click(screen.getByRole("combobox", { name: "Wiederholung" }));
      await user.click(
        await screen.findByRole("option", { name: "Wöchentlich" }),
      );
      expect(screen.getByRole("combobox", { name: "Wochentag" })).toBeVisible();
    } finally {
      act(() => i18n.activate("en"));
    }
  });

  it("associates an invalid Daily time selection with its error", async () => {
    const user = userEvent.setup();
    render(
      <ScheduledTaskForm
        task={task({ cronExpression: "0/1 * * * *" })}
        onCancel={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Frequency" }));
    await user.click(await screen.findByRole("option", { name: "Daily" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Select a valid time")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Time" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("uses the detected timezone without exposing an extra field", () => {
    render(<ScheduledTaskForm onCancel={vi.fn()} onSuccess={vi.fn()} />);

    expect(screen.queryByLabelText("Timezone")).not.toBeInTheDocument();
  });

  it("preserves the task timezone in an edit submission", async () => {
    const user = userEvent.setup();
    render(
      <ScheduledTaskForm
        task={task()}
        onCancel={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("Timezone")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 4, timezone: "America/New_York" }),
      expect.anything(),
    );
  });

  it("submits an unchecked email preference in the exact update input", async () => {
    const user = userEvent.setup();
    render(
      <ScheduledTaskForm
        task={task({ extraInfo: { sendEmailOnComplete: true } })}
        onCancel={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("checkbox", {
        name: "Notify me by email when completed",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(mockMutate).toHaveBeenCalledWith(
      {
        agentInstanceId: 8,
        attachments: [],
        cronExpression: "0 9 * * *",
        enabled: true,
        extraInfo: { sendEmailOnComplete: false },
        id: 4,
        message: "Run the report",
        name: "Daily report",
        timezone: "America/New_York",
      },
      expect.anything(),
    );
  });

  it("shows weekday only for Weekly schedules and accepts Sunday zero", async () => {
    const user = userEvent.setup();
    render(<ScheduledTaskForm onCancel={vi.fn()} onSuccess={vi.fn()} />);

    expect(screen.queryByLabelText("Day of week")).not.toBeInTheDocument();
    expect(screen.getByTestId("scheduled-task-schedule-fields")).toHaveClass(
      "grid-cols-2",
    );
    await user.click(screen.getByRole("combobox", { name: "Frequency" }));
    await user.click(await screen.findByRole("option", { name: "Weekly" }));
    expect(screen.getByTestId("scheduled-task-schedule-fields")).toHaveClass(
      "grid-cols-3",
    );
    expect(screen.getByRole("combobox", { name: "Frequency" })).toAppearBefore(
      screen.getByRole("combobox", { name: "Day of week" }),
    );
    expect(
      screen.getByRole("combobox", { name: "Day of week" }),
    ).toAppearBefore(screen.getByRole("combobox", { name: "Time" }));
    await user.click(screen.getByRole("combobox", { name: "Day of week" }));
    await user.click(await screen.findByRole("option", { name: "Sunday" }));

    expect(screen.getByLabelText("Day of week")).toHaveTextContent("Sunday");
    await user.click(screen.getByRole("combobox", { name: "Frequency" }));
    await user.click(await screen.findByRole("option", { name: "Daily" }));
    expect(screen.queryByLabelText("Day of week")).not.toBeInTheDocument();
  });

  it("requires a weekday before submitting a Weekly schedule", async () => {
    const user = userEvent.setup();
    render(
      <ScheduledTaskForm
        task={task()}
        onCancel={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Frequency" }));
    await user.click(await screen.findByRole("option", { name: "Weekly" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Select a day of the week")).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "Day of week" }),
    ).toHaveAttribute("aria-invalid", "true");
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("submits Sunday as weekday zero in a Weekly cron expression", async () => {
    const user = userEvent.setup();
    render(
      <ScheduledTaskForm
        task={task()}
        onCancel={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Frequency" }));
    await user.click(await screen.findByRole("option", { name: "Weekly" }));
    await user.click(screen.getByRole("combobox", { name: "Day of week" }));
    await user.click(await screen.findByRole("option", { name: "Sunday" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ cronExpression: "0 9 * * 0" }),
      expect.anything(),
    );
  });

  it("preserves custom cron exactly and allows an explicit Daily replacement", async () => {
    const user = userEvent.setup();
    render(
      <ScheduledTaskForm
        task={task({ cronExpression: " 0/1 * * * * " })}
        onCancel={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Custom schedule")).toHaveValue(
      " 0/1 * * * * ",
    );
    expect(screen.getByLabelText("Custom schedule")).toHaveAttribute(
      "readonly",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ cronExpression: " 0/1 * * * * " }),
      expect.anything(),
    );

    mockMutate.mockClear();
    await user.click(screen.getByRole("combobox", { name: "Frequency" }));
    await user.click(await screen.findByRole("option", { name: "Daily" }));
    await user.click(screen.getByRole("combobox", { name: "Time" }));
    await user.click(await screen.findByRole("option", { name: "9:00 AM" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.queryByLabelText("Custom schedule")).not.toBeInTheDocument();
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ cronExpression: "0 9 * * *" }),
      expect.anything(),
    );
  });

  it("replaces Custom cron with a Weekly schedule", async () => {
    const user = userEvent.setup();
    render(
      <ScheduledTaskForm
        task={task({ cronExpression: "0/1 * * * *" })}
        onCancel={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Frequency" }));
    await user.click(await screen.findByRole("option", { name: "Weekly" }));
    await user.click(screen.getByRole("combobox", { name: "Time" }));
    await user.click(await screen.findByRole("option", { name: "9:00 AM" }));
    await user.click(screen.getByRole("combobox", { name: "Day of week" }));
    await user.click(await screen.findByRole("option", { name: "Monday" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ cronExpression: "0 9 * * 1" }),
      expect.anything(),
    );
  });

  it("anchors a compact avatar worker menu to the instruction footer", async () => {
    const user = userEvent.setup();
    render(<ScheduledTaskForm onCancel={vi.fn()} onSuccess={vi.fn()} />);

    const worker = screen.getByRole("combobox", { name: "Digital Worker" });
    expect(worker).toHaveTextContent("Choose Digital worker");
    expect(worker).not.toHaveTextContent("Reporting Worker");
    expect(
      screen.getByTestId("scheduled-task-instruction-shell"),
    ).toContainElement(worker);
    await user.click(worker);

    await screen.findByRole("listbox");
    const options = screen.getByTestId("scheduled-task-worker-options");
    expect(options).toHaveAttribute("data-align", "start");
    expect(options).toHaveClass("!w-56", "max-h-60");
    const workerOption = screen.getByRole("option", {
      name: "Reporting Worker",
    });
    expect(workerOption).toHaveClass("pr-8");
    expect(within(workerOption).getByTestId("avatar-root")).toBeVisible();
    expect(within(workerOption).getByText("Reporting Worker")).toHaveClass(
      "max-w-32",
      "truncate",
    );

    await user.click(workerOption);

    expect(worker).toHaveTextContent("Reporting Worker");
    expect(worker).not.toHaveTextContent("Choose Digital worker");
  });

  it("renders an inactive bound worker in the trigger", () => {
    setWorkers();
    mockAgentQuery.mockReturnValue({
      data: { id: 8, name: "Inactive Reporting Worker" },
    });
    render(
      <ScheduledTaskForm
        task={task()}
        onCancel={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const worker = screen.getByRole("combobox", { name: "Digital Worker" });
    expect(worker).toHaveTextContent("Inactive Reporting Worker");
    expect(worker).not.toHaveTextContent("Choose Digital worker");
    expect(within(worker).getByTestId("avatar-root")).toBeVisible();
  });

  it("renders workers returned on a second page", async () => {
    const user = userEvent.setup();
    const firstPage = { items: [{ id: 8, name: "Reporting Worker" }] };
    const secondPage = { items: [{ id: 9, name: "Second Page Worker" }] };
    let pages = [firstPage];
    const fetchNextPage = vi.fn().mockImplementation(async () => {
      pages = [firstPage, secondPage];
    });
    mockAgentsQuery.mockImplementation(() => ({
      data: { pages },
      fetchNextPage,
      hasNextPage: pages.length === 1,
      isError: false,
      isFetchingNextPage: false,
      isPending: false,
    }));
    mockDedupedAgents.mockImplementation(
      (agentPages: { items: { id: number; name: string }[] }[] | undefined) =>
        agentPages?.flatMap((page) => page.items) ?? [],
    );
    const { rerender } = render(
      <ScheduledTaskForm onCancel={vi.fn()} onSuccess={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "Load more workers" }));
    expect(fetchNextPage).toHaveBeenCalledOnce();
    rerender(<ScheduledTaskForm onCancel={vi.fn()} onSuccess={vi.fn()} />);
    await user.click(screen.getByRole("combobox", { name: "Digital Worker" }));

    expect(
      await screen.findByRole("option", { name: "Second Page Worker" }),
    ).toBeVisible();
  });

  it("locks Save while an attachment upload or mutation is pending", () => {
    mockAttachments.mockReturnValue({
      addFile: vi.fn(),
      anyUploading: true,
      attachments: [],
      fileError: null,
      readyAttachments: [],
      removeAttachment: vi.fn(),
    });
    const { rerender } = render(
      <ScheduledTaskForm onCancel={vi.fn()} onSuccess={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    mockAttachments.mockReturnValue({
      addFile: vi.fn(),
      anyUploading: false,
      attachments: [],
      fileError: null,
      readyAttachments: [],
      removeAttachment: vi.fn(),
    });
    mockCreateMutation.mockReturnValue({ isPending: true, mutate: mockMutate });
    rerender(<ScheduledTaskForm onCancel={vi.fn()} onSuccess={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Saving…" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(
      screen.getByRole("checkbox", {
        name: "Notify me by email when completed",
      }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("toasts and reports the saved task after a successful mutation", async () => {
    const onSuccess = vi.fn();
    const toastSuccess = vi.spyOn(toast, "success");
    const savedTask = task({ id: 5 });
    mockMutate.mockImplementation(
      (
        _input: unknown,
        callbacks: { onSuccess: (saved: ScheduledTask) => void },
      ) => callbacks.onSuccess(savedTask),
    );
    const user = userEvent.setup();
    render(
      <ScheduledTaskForm
        task={task()}
        onCancel={vi.fn()}
        onSuccess={onSuccess}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(mockMutate).toHaveBeenCalledWith(
      {
        agentInstanceId: 8,
        attachments: [],
        cronExpression: "0 9 * * *",
        enabled: true,
        extraInfo: { sendEmailOnComplete: false },
        id: 4,
        message: "Run the report",
        name: "Daily report",
        timezone: "America/New_York",
      },
      expect.anything(),
    );
    expect(toastSuccess).toHaveBeenCalledWith("Scheduled task updated.");
    expect(onSuccess).toHaveBeenCalledWith(savedTask);
  });

  it("retains entered values after a mutation failure", async () => {
    const toastError = vi.spyOn(toast, "error");
    mockMutate.mockImplementation(
      (_input: unknown, callbacks: { onError: () => void }) =>
        callbacks.onError(),
    );
    const user = userEvent.setup();
    render(
      <ScheduledTaskForm
        task={task()}
        onCancel={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );
    const name = screen.getByLabelText("Task name");

    await user.clear(name);
    await user.type(name, "Still here");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(toastError).toHaveBeenCalledWith("Couldn't update scheduled task.");
    expect(name).toHaveValue("Still here");
  });

  it("surfaces a human-readable backend authorization error", async () => {
    const toastError = vi.spyOn(toast, "error");
    mockMutate.mockImplementation(
      (_input: unknown, callbacks: { onError: (error: Error) => void }) =>
        callbacks.onError(
          new EnvelopeError(100003, "forbidden", "updateScheduledTask"),
        ),
    );
    const user = userEvent.setup();
    render(
      <ScheduledTaskForm
        task={task()}
        onCancel={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(toastError).toHaveBeenCalledWith("forbidden");
  });

  it("retains ready attachments after a mutation failure", async () => {
    const readyAttachment = {
      name: "report.pdf",
      size: 1,
      type: "application/pdf",
      uri: "asset://report.pdf",
    };
    let syncReadyAttachments:
      | ((attachments: (typeof readyAttachment)[]) => void)
      | undefined;
    mockAttachments.mockImplementation(
      ({
        onReadyAttachmentsChange,
      }: {
        onReadyAttachmentsChange: (
          attachments: (typeof readyAttachment)[],
        ) => void;
      }) => {
        syncReadyAttachments = onReadyAttachmentsChange;
        return {
          addFile: vi.fn(),
          anyUploading: false,
          attachments: [],
          fileError: null,
          readyAttachments: [readyAttachment],
          removeAttachment: vi.fn(),
        };
      },
    );
    mockMutate.mockImplementation(
      (_input: unknown, callbacks: { onError: () => void }) =>
        callbacks.onError(),
    );
    const onDirtyChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ScheduledTaskForm
        task={task()}
        onCancel={vi.fn()}
        onDirtyChange={onDirtyChange}
        onSuccess={vi.fn()}
      />,
    );

    act(() => syncReadyAttachments?.([readyAttachment]));
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(mockMutate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ attachments: [readyAttachment] }),
      expect.anything(),
    );
    expect(mockMutate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ attachments: [readyAttachment] }),
      expect.anything(),
    );
  });

  it("submits a newly ready attachment before its sync callback runs", async () => {
    const readyAttachment = {
      name: "ready.pdf",
      size: 1,
      type: "application/pdf",
      uri: "asset://ready.pdf",
    };
    let readyAttachments: ScheduledTask["attachments"] = [];
    mockAttachments.mockImplementation(() => ({
      addFile: vi.fn(),
      anyUploading: false,
      attachments: readyAttachments.map((assetRef, index) => ({
        assetRef,
        localId: `attachment-${index}`,
        status: "ready",
      })),
      fileError: null,
      readyAttachments,
      removeAttachment: vi.fn(),
      reset: mockReset,
    }));
    const user = userEvent.setup();
    const currentTask = task({ attachments: [] });
    const { rerender } = render(
      <ScheduledTaskForm
        task={currentTask}
        onCancel={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    readyAttachments = [readyAttachment];
    rerender(
      <ScheduledTaskForm
        task={currentTask}
        onCancel={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ attachments: [readyAttachment] }),
      expect.anything(),
    );
  });

  it("submits a removed attachment as absent before its sync callback runs", async () => {
    const removedAttachment = {
      name: "removed.pdf",
      size: 1,
      type: "application/pdf",
      uri: "asset://removed.pdf",
    };
    let readyAttachments: ScheduledTask["attachments"] = [removedAttachment];
    mockAttachments.mockImplementation(() => ({
      addFile: vi.fn(),
      anyUploading: false,
      attachments: readyAttachments.map((assetRef, index) => ({
        assetRef,
        localId: `attachment-${index}`,
        status: "ready",
      })),
      fileError: null,
      readyAttachments,
      removeAttachment: vi.fn(),
      reset: mockReset,
    }));
    const user = userEvent.setup();
    const currentTask = task({ attachments: [removedAttachment] });
    const { rerender } = render(
      <ScheduledTaskForm
        task={currentTask}
        onCancel={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    readyAttachments = [];
    rerender(
      <ScheduledTaskForm
        task={currentTask}
        onCancel={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ attachments: [] }),
      expect.anything(),
    );
  });

  it.each([
    { firstValue: true, secondValue: false },
    { firstValue: false, secondValue: true },
  ])(
    "resets the email preference from $firstValue to $secondValue when the task identity changes",
    async ({ firstValue, secondValue }) => {
      const firstTask = task({
        extraInfo: { sendEmailOnComplete: firstValue },
      });
      const secondTask = task({
        extraInfo: { sendEmailOnComplete: secondValue },
        id: 5,
      });
      const { rerender } = render(
        <ScheduledTaskForm
          task={firstTask}
          onCancel={vi.fn()}
          onSuccess={vi.fn()}
        />,
      );
      const checkbox = screen.getByRole("checkbox", {
        name: "Notify me by email when completed",
      });
      if (firstValue) {
        expect(checkbox).toBeChecked();
      } else {
        expect(checkbox).not.toBeChecked();
      }

      rerender(
        <ScheduledTaskForm
          task={secondTask}
          onCancel={vi.fn()}
          onSuccess={vi.fn()}
        />,
      );

      await waitFor(() => {
        if (secondValue) {
          expect(checkbox).toBeChecked();
        } else {
          expect(checkbox).not.toBeChecked();
        }
      });
    },
  );

  it("resets a mounted form when its task identity changes", async () => {
    const firstAttachment = {
      name: "first.pdf",
      size: 1,
      type: "application/pdf",
      uri: "asset://first.pdf",
    };
    const secondAttachment = {
      name: "second.pdf",
      size: 1,
      type: "application/pdf",
      uri: "asset://second.pdf",
    };
    const firstTask = task({ attachments: [firstAttachment] });
    const secondTask = task({
      agentInstanceId: 9,
      attachments: [secondAttachment],
      cronExpression: "30 14 * * 1",
      id: 5,
      message: "Second instructions",
      name: "Second task",
      timezone: "Asia/Tokyo",
    });
    mockAttachments.mockImplementation(
      ({
        initialAttachments = [],
      }: {
        initialAttachments?: ScheduledTask["attachments"];
      }) => ({
        addFile: vi.fn(),
        anyUploading: false,
        attachments: initialAttachments.map((assetRef, index) => ({
          assetRef,
          localId: `attachment-${index}`,
          status: "ready",
        })),
        fileError: null,
        readyAttachments: initialAttachments,
        removeAttachment: vi.fn(),
        reset: mockReset,
      }),
    );
    setWorkers(
      { id: 8, name: "First Worker" },
      { id: 9, name: "Second Worker" },
    );
    const onDirtyChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <ScheduledTaskForm
        task={firstTask}
        onCancel={vi.fn()}
        onDirtyChange={onDirtyChange}
        onSuccess={vi.fn()}
      />,
    );
    await user.clear(screen.getByLabelText("Task name"));
    await user.type(screen.getByLabelText("Task name"), "Dirty first task");
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));

    rerender(
      <ScheduledTaskForm
        task={secondTask}
        onCancel={vi.fn()}
        onDirtyChange={onDirtyChange}
        onSuccess={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Task name")).toHaveValue("Second task"),
    );
    expect(screen.getByLabelText("Instruction")).toHaveValue(
      "Second instructions",
    );
    const worker = screen.getByRole("combobox", { name: "Digital Worker" });
    expect(worker).toHaveTextContent("Second Worker");
    expect(worker).not.toHaveTextContent("Choose Digital worker");
    expect(within(worker).getByTestId("avatar-root")).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "Frequency" }),
    ).toHaveTextContent("Weekly");
    expect(screen.getByRole("combobox", { name: "Time" })).toHaveTextContent(
      "2:30 PM",
    );
    expect(screen.queryByLabelText("Timezone")).not.toBeInTheDocument();
    expect(screen.getByText("second.pdf")).toBeVisible();
    expect(screen.queryByText("first.pdf")).not.toBeInTheDocument();
    expect(mockReset).toHaveBeenCalledWith([secondAttachment]);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [secondAttachment],
        id: 5,
        timezone: "Asia/Tokyo",
      }),
      expect.anything(),
    );
  });

  it("preserves edits on an ordinary rerender of the same task", async () => {
    const currentTask = task();
    const user = userEvent.setup();
    const { rerender } = render(
      <ScheduledTaskForm
        task={currentTask}
        onCancel={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );
    const name = screen.getByLabelText("Task name");

    await user.clear(name);
    await user.type(name, "Unsubmitted edit");
    await user.click(
      screen.getByRole("checkbox", {
        name: "Notify me by email when completed",
      }),
    );
    mockReset.mockClear();
    rerender(
      <ScheduledTaskForm
        task={{ ...currentTask }}
        onCancel={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(name).toHaveValue("Unsubmitted edit");
    expect(
      screen.getByRole("checkbox", {
        name: "Notify me by email when completed",
      }),
    ).toBeChecked();
    expect(mockReset).not.toHaveBeenCalled();
  });

  it("keeps deletion out of the edit form footer", () => {
    render(
      <ScheduledTaskForm
        task={task()}
        onCancel={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Save" })).toBeVisible();
  });

  it("reports dirty state after a user edits the task name", async () => {
    const onDirtyChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ScheduledTaskForm
        onCancel={vi.fn()}
        onDirtyChange={onDirtyChange}
        onSuccess={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText("Task name"), "Report");

    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
  });

  it("reports dirty state while an attachment is uploading", async () => {
    const onDirtyChange = vi.fn();
    mockAttachments.mockReturnValue({
      addFile: vi.fn(),
      anyUploading: true,
      attachments: [],
      fileError: null,
      readyAttachments: [],
      removeAttachment: vi.fn(),
      reset: mockReset,
    });

    render(
      <ScheduledTaskForm
        onCancel={vi.fn()}
        onDirtyChange={onDirtyChange}
        onSuccess={vi.fn()}
      />,
    );

    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
  });
});
