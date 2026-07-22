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

import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  CornerDownLeftIcon,
  EyeIcon,
  EyeOffIcon,
  MailIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "../src/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "../src/components/ui/input-group";

/**
 * `<InputGroup>` is the form-control shell. Drop an `<InputGroupInput>` or
 * `<InputGroupTextarea>` inside, then add `<InputGroupAddon>` slots on any
 * side for icons, prefixes, suffix buttons, or block-aligned footers.
 *
 * State propagation uses `data-*` + `aria-*` attributes — no Context.
 */
const meta = {
  title: "Components/InputGroup",
  component: InputGroup,
  args: {
    className: "max-w-sm",
  },
} satisfies Meta<typeof InputGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

/* ─── Single-control basics ──────────────────────────────────── */

/**
 * Bare wrapper around `<InputGroupInput>` — no affixes. The minimum needed
 * to opt in to the group's focus-visible border and invalid styling.
 */
export const Default: Story = {
  render: (args) => (
    <InputGroup {...args}>
      <InputGroupInput placeholder="Type here…" />
    </InputGroup>
  ),
};

/**
 * `disabled` on the inner control is picked up by the shell via the
 * `has-disabled:` selector — the whole group dims (background, text, border)
 * without any extra wiring.
 */
export const Disabled: Story = {
  render: (args) => (
    <InputGroup {...args}>
      <InputGroupInput placeholder="Disabled" disabled />
    </InputGroup>
  ),
};

/**
 * `aria-invalid="true"` on the inner control is picked up by the shell via
 * `has-[[data-slot][aria-invalid=true]]:*` — fill switches to
 * `input-fill-error` and border to `input-stroke-error`. No focus ring.
 */
export const Invalid: Story = {
  render: (args) => (
    <InputGroup {...args}>
      <InputGroupInput aria-invalid="true" defaultValue="not-an-email" />
    </InputGroup>
  ),
};

/* ─── Addon positions ────────────────────────────────────────── */

/**
 * Icon at the start. `<InputGroupAddon>` defaults to `align="inline-start"`.
 */
export const LeadingIcon: Story = {
  render: (args) => (
    <InputGroup {...args}>
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput placeholder="Search…" />
    </InputGroup>
  ),
};

/**
 * Icon at the end via `align="inline-end"`. Common for inline format hints.
 */
export const TrailingIcon: Story = {
  render: (args) => (
    <InputGroup {...args}>
      <InputGroupInput placeholder="you@example.com" type="email" />
      <InputGroupAddon align="inline-end">
        <MailIcon />
      </InputGroupAddon>
    </InputGroup>
  ),
};

/**
 * Static text prefix — typical for URL or currency inputs.
 */
export const LeadingText: Story = {
  render: (args) => (
    <InputGroup {...args}>
      <InputGroupAddon>
        <InputGroupText>https://</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput placeholder="example.com" />
    </InputGroup>
  ),
};

/**
 * Static text suffix — useful for unit labels (USD, %, /month).
 */
export const TrailingText: Story = {
  render: (args) => (
    <InputGroup {...args}>
      <InputGroupInput placeholder="0.00" type="number" />
      <InputGroupAddon align="inline-end">
        <InputGroupText>USD</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  ),
};

/**
 * Action button as a suffix. Use `<InputGroupButton>` for the correct height
 * and rounded-end alignment.
 */
export const TrailingButton: Story = {
  render: (args) => (
    <InputGroup {...args}>
      <InputGroupInput placeholder="Search and press Enter" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton aria-label="Submit search">
          <CornerDownLeftIcon />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
};

/* ─── Textarea variants ──────────────────────────────────────── */

/**
 * Replace `<InputGroupInput>` with `<InputGroupTextarea>` for multi-line
 * input. Auto-grows via `field-sizing-content`.
 */
export const WithTextarea: Story = {
  args: { className: "max-w-md" },
  render: (args) => (
    <InputGroup {...args}>
      <InputGroupTextarea placeholder="Write a short bio…" />
    </InputGroup>
  ),
};

/**
 * `<InputGroupAddon align="block-end">` becomes a footer row beneath the
 * textarea — perfect for a live character counter.
 */
export const TextareaWithBlockFooter: Story = {
  render: () => {
    const MAX = 200;
    return <TextareaWithCounter max={MAX} />;
  },
};

/**
 * `<InputGroupAddon align="block-start">` creates a header row above the
 * control, useful for textarea labels, section chips, or leading context.
 */
export const TextareaWithBlockHeader: Story = {
  args: { className: "max-w-md" },
  render: (args) => (
    <InputGroup {...args}>
      <InputGroupAddon align="block-start" className="justify-between border-b">
        <InputGroupText>Message</InputGroupText>
        <InputGroupText>Optional</InputGroupText>
      </InputGroupAddon>
      <InputGroupTextarea placeholder="Write your message…" />
    </InputGroup>
  ),
};

/* ─── Button sizes ───────────────────────────────────────────── */

/**
 * `<InputGroupButton>` offers four sizes: `xs` (default, compact text
 * action), `sm` (full-height text action), `icon-xs` (compact square icon),
 * and `icon-sm` (full-height square icon). All four are shown here side-by-
 * side for visual comparison.
 */
export const ButtonSizes: Story = {
  render: () => (
    <div className="flex max-w-sm flex-col gap-4">
      <InputGroup>
        <InputGroupInput placeholder="size=xs (default)" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton aria-label="Submit" size="xs">
            <CornerDownLeftIcon />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <InputGroup>
        <InputGroupInput placeholder="size=sm" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton aria-label="Submit" size="sm">
            Submit
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <InputGroup>
        <InputGroupInput placeholder="size=icon-xs" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton aria-label="Submit" size="icon-xs">
            <CornerDownLeftIcon />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <InputGroup>
        <InputGroupInput placeholder="size=icon-sm" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton aria-label="Submit" size="icon-sm">
            <CornerDownLeftIcon />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  ),
};

/* ─── Composition recipes ────────────────────────────────────── */

/**
 * Recreates every feature the previous monolithic `<Input>` shipped with —
 * label, description, error, clearable, password toggle, icon affixes,
 * textarea + char counter — using only the new primitives. Proves the
 * decomposition is a 1:1 functional replacement, not a regression.
 */
export const CompositionRecipes: Story = {
  render: () => (
    <div className="flex max-w-md flex-col gap-8">
      <CompositionEmail />
      <CompositionSearchClearable />
      <CompositionPasswordToggle />
      <CompositionTextareaWithCounter />
      <CompositionInvalidWithError />
    </div>
  ),
};

/* ─── Recipe components ──────────────────────────────────────── */

function CompositionEmail(): React.ReactElement {
  return (
    <Field>
      <FieldLabel htmlFor="rcp-email">Email</FieldLabel>
      <InputGroup>
        <InputGroupAddon>
          <MailIcon />
        </InputGroupAddon>
        <InputGroupInput
          id="rcp-email"
          type="email"
          placeholder="you@example.com"
        />
      </InputGroup>
      <FieldDescription>We&rsquo;ll never share your email.</FieldDescription>
    </Field>
  );
}

function CompositionSearchClearable(): React.ReactElement {
  const [value, setValue] = useState("Composable primitives");
  return (
    <Field>
      <FieldLabel htmlFor="rcp-search">Search</FieldLabel>
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          id="rcp-search"
          placeholder="Search…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        {value.length > 0 ? (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              aria-label="Clear search"
              size="icon-xs"
              onClick={() => setValue("")}
            >
              <XIcon />
            </InputGroupButton>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
    </Field>
  );
}

function CompositionPasswordToggle(): React.ReactElement {
  const [visible, setVisible] = useState(false);
  return (
    <Field>
      <FieldLabel htmlFor="rcp-pwd">Password</FieldLabel>
      <InputGroup>
        <InputGroupInput
          id="rcp-pwd"
          type={visible ? "text" : "password"}
          defaultValue="hunter2"
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            aria-label={visible ? "Hide password" : "Show password"}
            aria-pressed={visible}
            size="icon-xs"
            onClick={() => setVisible((v) => !v)}
          >
            {visible ? <EyeOffIcon /> : <EyeIcon />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <FieldDescription>At least 8 characters.</FieldDescription>
    </Field>
  );
}

function CompositionTextareaWithCounter(): React.ReactElement {
  return (
    <Field>
      <FieldLabel htmlFor="rcp-bio">Bio</FieldLabel>
      <TextareaWithCounter id="rcp-bio" max={200} />
    </Field>
  );
}

function CompositionInvalidWithError(): React.ReactElement {
  return (
    <Field data-invalid="true">
      <FieldLabel htmlFor="rcp-email-bad">Email (invalid example)</FieldLabel>
      <InputGroup>
        <InputGroupAddon>
          <MailIcon />
        </InputGroupAddon>
        <InputGroupInput
          id="rcp-email-bad"
          type="email"
          aria-invalid="true"
          defaultValue="not-an-email"
        />
      </InputGroup>
      <FieldError>Please enter a valid email address.</FieldError>
    </Field>
  );
}

/* ─── Local helpers ──────────────────────────────────────────── */

type TextareaWithCounterProps = {
  id?: string;
  max: number;
};

function TextareaWithCounter({
  id,
  max,
}: TextareaWithCounterProps): React.ReactElement {
  const [value, setValue] = useState("");
  return (
    <InputGroup className="max-w-md">
      <InputGroupTextarea
        id={id}
        placeholder="Tell us about yourself…"
        value={value}
        onChange={(e) => setValue(e.target.value.slice(0, max))}
      />
      <InputGroupAddon align="block-end" className="justify-end">
        <InputGroupText>
          {value.length}/{max}
        </InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  );
}
