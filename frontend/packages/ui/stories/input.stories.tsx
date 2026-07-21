import type { Meta, StoryObj } from "@storybook/react-vite";

import { Input } from "../src/components/ui/input";

/**
 * Bare native input. For affixes, password toggle, clear button, label,
 * description, or error text, compose with `<InputGroup>` and `<Field>` —
 * see those stories.
 */
const meta = {
  title: "Components/Input",
  component: Input,
  args: {
    placeholder: "Type here…",
  },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Empty state with placeholder. The most common starting point.
 */
export const Default: Story = {};

/**
 * Filled state via `defaultValue`. Use `value` + `onChange` for controlled
 * inputs.
 */
export const WithValue: Story = {
  args: { defaultValue: "John Doe" },
};

/**
 * Disabled state. The native `disabled` attribute blocks pointer events;
 * styling switches to the canvas surface fill with faint text
 * (`disabled:bg-surface-canvas disabled:text-foreground-faint`).
 */
export const Disabled: Story = {
  args: { disabled: true, defaultValue: "Can't edit this" },
};

/**
 * Validation failure. `aria-invalid="true"` is the trigger — the
 * `aria-invalid:bg-input-fill-error` and `aria-invalid:border-input-stroke-error`
 * variants swap the fill and border to the danger tones. No focus ring.
 */
export const Invalid: Story = {
  args: { "aria-invalid": "true", defaultValue: "not-an-email" },
};

/**
 * Password input — characters are masked by the browser. For show/hide
 * toggle, see `<InputGroup>` recipes.
 */
export const Password: Story = {
  args: { type: "password", defaultValue: "hunter2" },
};

/**
 * Email input with native validation hints from the browser.
 */
export const Email: Story = {
  args: { type: "email", placeholder: "you@example.com" },
};

/**
 * Number input. Browser-rendered spinner buttons may vary across platforms.
 */
export const Number: Story = {
  args: { type: "number", placeholder: "0" },
};
