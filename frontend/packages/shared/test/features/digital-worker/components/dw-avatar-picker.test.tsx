import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DwAvatarPicker } from "@/features/digital-worker/components/dw-avatar-picker";
import {
  DW_AVATAR_PRESETS,
  type DwAvatarPreset,
} from "@/features/digital-worker/constants";
import { safeIconUri } from "@/utils/safe-icon-uri";

// Keep DwAvatar's URL guard, but bypass Base UI's off-DOM image loader in jsdom.
vi.mock("@sico/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sico/ui")>();
  return {
    ...actual,
    AvatarImage: ({ src, alt }: { src?: string; alt?: string }) => (
      <img src={src} alt={alt} data-testid="avatar-image" />
    ),
  };
});

function ControlledPicker(): React.JSX.Element {
  const [preset, setPreset] = useState<DwAvatarPreset>(DW_AVATAR_PRESETS[0]);
  return <DwAvatarPicker preset={preset} onChange={setPreset} />;
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DW avatar presets", () => {
  it("keeps all 18 original IDs in their design order", () => {
    expect(DW_AVATAR_PRESETS.map(({ id }) => id)).toEqual([
      "7661735044905435136",
      "7661735044892852224",
      "7661735044901240832",
      "7661735044934795264",
      "7661735044926406656",
      "7661735044884463616",
      "7661735051360468992",
      "7661735048449622016",
      "7661735051435982848",
      "7661735051435966464",
      "7661735051473715200",
      "7661735051519852544",
      "7661735054938210304",
      "7661735058029412352",
      "7661735057962303488",
      "7661735058012635136",
      "7661735057974886400",
      "7661735058180407296",
    ]);
  });

  it.each(DW_AVATAR_PRESETS)("uses a safe bundled PNG for $id", (preset) => {
    expect(preset.src).toMatch(/^\/(?!\/).*\.png$/);
    expect(safeIconUri(preset.src)).toBe(preset.src);
  });
});

describe("<DwAvatarPicker>", () => {
  it.each([
    { locale: "en", prefix: "Avatar " },
    { locale: "zh-CN", prefix: "头像 " },
  ])(
    "supplies the named index expected by the $locale catalog",
    async ({ locale, prefix }) => {
      const user = userEvent.setup();
      const i18n = setupI18n();
      i18n.loadAndActivate({
        locale,
        messages: {
          "digitalWorker.avatarPicker.changeAvatarAria": "Change avatar",
          "digitalWorker.avatarPicker.avatarAria": [prefix, ["index"]],
        },
      });
      render(
        <I18nProvider i18n={i18n}>
          <ControlledPicker />
        </I18nProvider>,
      );

      await user.click(screen.getByRole("button", { name: "Change avatar" }));

      expect(screen.getByRole("radio", { name: `${prefix}1` })).toBeChecked();
      expect(
        screen.getByRole("radio", { name: `${prefix}18` }),
      ).not.toBeChecked();
    },
  );

  it("renders the controlled first preset with the grid collapsed", () => {
    render(<ControlledPicker />);

    expect(
      screen.getByRole("button", { name: "Change avatar" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("avatar-image")).toHaveAttribute(
      "src",
      DW_AVATAR_PRESETS[0].src,
    );
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("expands all 18 options and marks the selected preset", async () => {
    const user = userEvent.setup();
    render(<ControlledPicker />);

    await user.click(screen.getByRole("button", { name: "Change avatar" }));

    expect(screen.getAllByRole("radio")).toHaveLength(18);
    expect(screen.getByRole("radio", { name: "Avatar 1" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "Avatar 1" })).toHaveClass(
      "ring-focus-rest",
      "ring-2",
    );
    expect(screen.getAllByRole("radio", { checked: false })).toHaveLength(17);
  });

  it("selects another preset and updates the preview", async () => {
    const user = userEvent.setup();
    render(<ControlledPicker />);
    const trigger = screen.getByRole("button", { name: "Change avatar" });

    await user.click(trigger);
    await user.click(screen.getByRole("radio", { name: "Avatar 9" }));

    expect(screen.getByRole("radio", { checked: true })).toHaveAccessibleName(
      "Avatar 9",
    );
    expect(within(trigger).getByTestId("avatar-image")).toHaveAttribute(
      "src",
      DW_AVATAR_PRESETS[8].src,
    );
  });

  it("only requests a change until the parent supplies a new preset", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <DwAvatarPicker preset={DW_AVATAR_PRESETS[0]} onChange={onChange} />,
    );
    await user.click(screen.getByRole("button", { name: "Change avatar" }));
    await user.click(screen.getByRole("radio", { name: "Avatar 2" }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith(DW_AVATAR_PRESETS[1]);
    expect(screen.getByRole("radio", { checked: true })).toHaveAccessibleName(
      "Avatar 1",
    );
    rerender(
      <DwAvatarPicker preset={DW_AVATAR_PRESETS[1]} onChange={onChange} />,
    );
    expect(screen.getByRole("radio", { checked: true })).toHaveAccessibleName(
      "Avatar 2",
    );
  });

  it.each(DW_AVATAR_PRESETS)(
    "Shuffle excludes the current preset $id",
    async (preset) => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const random = vi.spyOn(Math, "random");
      render(<DwAvatarPicker preset={preset} onChange={onChange} />);

      // Exercise every selectable position, not just one lucky random choice.
      for (let index = 0; index < 17; index += 1) {
        random.mockReturnValue(index / 17);
        await user.click(
          screen.getByRole("button", { name: "Shuffle avatar" }),
        );
      }

      expect(onChange.mock.calls.map(([next]) => next)).toEqual(
        DW_AVATAR_PRESETS.filter((option) => option.id !== preset.id),
      );
    },
  );

  it.each([
    { disabled: true, uploading: false },
    { disabled: false, uploading: true },
  ])("locks the avatar trigger and Shuffle when %j", async (state) => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DwAvatarPicker
        preset={DW_AVATAR_PRESETS[0]}
        onChange={onChange}
        disabled={state.disabled}
        uploading={state.uploading}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Change avatar" });
    const shuffle = screen.getByRole("button", { name: "Shuffle avatar" });

    expect(trigger).toBeDisabled();
    expect(shuffle).toBeDisabled();
    await user.click(trigger);
    await user.click(shuffle);
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    { disabled: true, uploading: false },
    { disabled: false, uploading: true },
  ])("locks an already expanded grid when %j", async (state) => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <DwAvatarPicker preset={DW_AVATAR_PRESETS[0]} onChange={onChange} />,
    );
    await user.click(screen.getByRole("button", { name: "Change avatar" }));
    rerender(
      <DwAvatarPicker
        preset={DW_AVATAR_PRESETS[0]}
        onChange={onChange}
        disabled={state.disabled}
        uploading={state.uploading}
      />,
    );

    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toBeDisabled();
    }
    await user.click(screen.getByRole("radio", { name: "Avatar 2" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("announces Save-time uploading", () => {
    render(
      <DwAvatarPicker
        preset={DW_AVATAR_PRESETS[0]}
        onChange={vi.fn()}
        uploading
      />,
    );

    expect(
      screen.getByRole("button", { name: "Change avatar" }),
    ).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Uploading…")).toBeVisible();
  });

  it("has no custom-file input", async () => {
    const user = userEvent.setup();
    const { container } = render(<ControlledPicker />);
    await user.click(screen.getByRole("button", { name: "Change avatar" }));

    expect(container.getElementsByTagName("input")).toHaveLength(0);
    expect(screen.queryByLabelText("Avatar file")).not.toBeInTheDocument();
  });

  it("opens, selects, and shuffles without network calls or form submission", async () => {
    const user = userEvent.setup();
    const fetch = vi.spyOn(globalThis, "fetch");
    const send = vi.spyOn(XMLHttpRequest.prototype, "send");
    const onSubmit = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <ControlledPicker />
      </form>,
    );

    await user.click(screen.getByRole("button", { name: "Change avatar" }));
    await user.click(screen.getByRole("radio", { name: "Avatar 2" }));
    await user.click(screen.getByRole("button", { name: "Shuffle avatar" }));

    expect(fetch).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
