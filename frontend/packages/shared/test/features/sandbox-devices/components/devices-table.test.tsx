import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DevicesTable } from "@/features/sandbox-devices/components/devices-table";
import { type Device } from "@/features/sandbox-devices/schemas/device";

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

describe("DevicesTable RBAC gating", () => {
  it("renders a working Assign action per row when canAssign is true", async () => {
    const onAssign = vi.fn();
    const device = makeDevice();
    const user = userEvent.setup();
    render(<DevicesTable devices={[device]} canAssign onAssign={onAssign} />);

    await user.click(screen.getByRole("button", { name: "Assign" }));
    expect(onAssign).toHaveBeenCalledWith(device);
  });

  it("shows a disabled Assign button (with a reason) when canAssign is false", () => {
    render(
      <DevicesTable
        devices={[makeDevice()]}
        canAssign={false}
        onAssign={vi.fn()}
      />,
    );

    // The action stays visible so the capability is discoverable, but it's
    // disabled (aria-disabled) rather than hidden, and the ACTIONS column stays.
    const button = screen.getByRole("button", { name: "Assign" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("columnheader", { name: "ACTIONS" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Device One")).toBeInTheDocument();
  });

  it("does not fire onAssign when the disabled button is clicked", async () => {
    const onAssign = vi.fn();
    const user = userEvent.setup();
    render(
      <DevicesTable
        devices={[makeDevice()]}
        canAssign={false}
        onAssign={onAssign}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Assign" }));
    expect(onAssign).not.toHaveBeenCalled();
  });
});
