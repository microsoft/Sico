import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { Field, FieldLabel } from "@sico/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn, userEvent, within } from "storybook/test";

import { DwAvatarPicker } from "@/features/digital-worker/components/dw-avatar-picker";
import {
  DW_AVATAR_PRESETS,
  type DwAvatarPreset,
} from "@/features/digital-worker/constants";

// Static Storybook strips source fallbacks; keep the demo independent of CI catalogs.
i18n.load("en", {
  "digitalWorker.addDialog.avatarLabel": "Avatar",
  "digitalWorker.avatarPicker.changeAvatarAria": "Change avatar",
  "digitalWorker.avatarPicker.shuffleAvatarAria": "Shuffle avatar",
  "digitalWorker.avatarPicker.groupAria": "Avatar",
  "digitalWorker.avatarPicker.avatarAria": ["Avatar ", ["index"]],
  "digitalWorker.avatarPicker.hint":
    "Click the avatar or Shuffle to generate another one.",
  "common.status.uploading": "Uploading…",
});
if (!i18n.locale) {
  i18n.activate("en");
}

const meta = {
  title: "Components/DwAvatarPicker",
  component: DwAvatarPicker,
  args: {
    preset: DW_AVATAR_PRESETS[0],
    onChange: fn(),
    disabled: false,
    uploading: false,
  },
  parameters: {
    layout: "centered",
    docs: {
      source: {
        code: "const [preset, setPreset] = useState<DwAvatarPreset>(DW_AVATAR_PRESETS[0]);\n<DwAvatarPicker preset={preset} onChange={setPreset} disabled={saving} uploading={uploading} />",
      },
    },
  },
  decorators: [
    (Story) => (
      <I18nProvider i18n={i18n}>
        <Field className="w-80">
          <FieldLabel>
            <Trans id="digitalWorker.addDialog.avatarLabel">Avatar</Trans>
          </FieldLabel>
          <Story />
        </Field>
      </I18nProvider>
    ),
  ],
  render: function InteractivePicker(args) {
    const [preset, setPreset] = useState<DwAvatarPreset>(args.preset);
    return (
      <DwAvatarPicker
        disabled={args.disabled}
        uploading={args.uploading}
        preset={preset}
        onChange={(next) => {
          setPreset(next);
          args.onChange(next);
        }}
      />
    );
  },
} satisfies Meta<typeof DwAvatarPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The first bundled portrait is selected; click it or Shuffle to choose locally. */
export const Default: Story = {};

/** Clicking the avatar reveals all 18 presets and the current selection ring. */
export const Expanded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Change avatar" }),
    );
  },
};

/** A different controlled starting preset uses the same bundled source as its grid option. */
export const SelectedPreset: Story = {
  args: { preset: DW_AVATAR_PRESETS[8] },
};

/** Save-time image preparation or uploading shows an overlay and locks selection. */
export const Uploading: Story = { args: { uploading: true } };

/** Creating the worker disables avatar expansion and Shuffle independently of uploading. */
export const Disabled: Story = { args: { disabled: true } };
