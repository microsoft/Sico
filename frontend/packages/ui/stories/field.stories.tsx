import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "../src/components/ui/field";
import { Input } from "../src/components/ui/input";
import { Textarea } from "../src/components/ui/textarea";

/**
 * `<Field>` is a shadcn-style wrapper that uses `data-*` attributes (not
 * Context) to propagate orientation / invalid / disabled state to descendants.
 * Pair it with `<FieldLabel>`, `<FieldDescription>`, and `<FieldError>` to
 * compose a labelled form control.
 */
const meta = {
  title: "Components/Field",
  component: Field,
  args: {
    orientation: "vertical",
  },
  // Single component args don't make sense without a control inside the field,
  // so every story uses `render` to assemble label + control + helper text.
  render: (args) => (
    <Field {...args}>
      <FieldLabel htmlFor="demo-name">Full name</FieldLabel>
      <Input id="demo-name" placeholder="Jane Doe" />
      <FieldDescription>As it appears on your ID.</FieldDescription>
    </Field>
  ),
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default `vertical` orientation: label on top, control below, description
 * beneath. Most common in forms.
 */
export const Vertical: Story = {};

/**
 * `horizontal` lays label and control side-by-side. Use in settings panels
 * or compact inline forms.
 */
export const Horizontal: Story = {
  args: { orientation: "horizontal" },
};

/**
 * `responsive` needs a sized `<FieldGroup>` ancestor to flip layout at the
 * `@md` container breakpoint (≥ 448px). Below that, the field stacks
 * vertically; above, it lays out horizontally. Drag the canvas edge narrower
 * than ~448px to see the transition.
 */
export const Responsive: Story = {
  args: { orientation: "responsive" },
  render: (args) => (
    <FieldGroup className="max-w-xl">
      <Field {...args}>
        <FieldLabel htmlFor="demo-name-r">Full name</FieldLabel>
        <Input id="demo-name-r" placeholder="Jane Doe" />
        <FieldDescription>
          Resize the canvas below 448px to watch this field collapse to a column
          (`@md/field-group` breakpoint).
        </FieldDescription>
      </Field>
    </FieldGroup>
  ),
};

/**
 * Setting `data-invalid` on the Field tints the whole subtree via the
 * ancestor `data-[invalid=true]:text-danger-700` selector — no prop wiring.
 * Label / Description / Error all inherit the error color through CSS
 * inheritance.
 */
export const InvalidState: Story = {
  render: () => (
    <Field data-invalid="true">
      <FieldLabel htmlFor="demo-email-inv">Email</FieldLabel>
      <Input
        id="demo-email-inv"
        type="email"
        aria-invalid="true"
        defaultValue="not-an-email"
      />
      <FieldError>Please enter a valid email address.</FieldError>
    </Field>
  ),
};

/**
 * `<FieldError>` accepts an `errors` array (e.g. from React Hook Form /
 * TanStack Form). Duplicates are de-duplicated by message.
 */
export const ErrorFromArray: Story = {
  render: () => (
    <Field data-invalid="true">
      <FieldLabel htmlFor="demo-pwd">Password</FieldLabel>
      <Input id="demo-pwd" type="password" aria-invalid="true" />
      <FieldError
        errors={[
          { message: "Must be at least 8 characters." },
          { message: "Must include at least one number." },
        ]}
      />
    </Field>
  ),
};

/**
 * `<FieldGroup>` stacks multiple fields and sets the `@container` so
 * `responsive` orientation works inside it.
 */
export const FieldGroupVertical: Story = {
  render: () => (
    <FieldGroup className="max-w-md">
      <Field>
        <FieldLabel htmlFor="fg-first">First name</FieldLabel>
        <Input id="fg-first" placeholder="Jane" />
      </Field>
      <Field>
        <FieldLabel htmlFor="fg-last">Last name</FieldLabel>
        <Input id="fg-last" placeholder="Doe" />
      </Field>
      <Field>
        <FieldLabel htmlFor="fg-bio">Bio</FieldLabel>
        <Textarea id="fg-bio" placeholder="A short bio…" />
        <FieldDescription>Markdown is not supported.</FieldDescription>
      </Field>
    </FieldGroup>
  ),
};

/**
 * Multiple fields inside a `<FieldGroup>` all using `orientation="responsive"`.
 * Combine for a label-on-left form that collapses to stacked on narrow viewports.
 */
export const FieldGroupResponsive: Story = {
  render: () => (
    <FieldGroup className="max-w-xl">
      <Field orientation="responsive">
        <FieldLabel htmlFor="fgr-name">Display name</FieldLabel>
        <Input id="fgr-name" placeholder="@jane" />
      </Field>
      <Field orientation="responsive">
        <FieldLabel htmlFor="fgr-email">Contact email</FieldLabel>
        <Input id="fgr-email" type="email" placeholder="jane@example.com" />
      </Field>
      <Field orientation="responsive">
        <FieldLabel htmlFor="fgr-bio">About</FieldLabel>
        <Textarea id="fgr-bio" placeholder="Tell us a bit…" />
      </Field>
    </FieldGroup>
  ),
};

/**
 * `<FieldSet>` is a semantic `<fieldset>` with a `<FieldLegend>` heading. Use
 * it whenever a group of fields share a single conceptual label.
 */
export const FieldSetWithLegend: Story = {
  render: () => (
    <FieldSet className="max-w-md">
      <FieldLegend>Shipping address</FieldLegend>
      <FieldDescription>
        We&rsquo;ll only use this to send your order.
      </FieldDescription>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="addr-line1">Street</FieldLabel>
          <Input id="addr-line1" placeholder="123 Main St" />
        </Field>
        <Field>
          <FieldLabel htmlFor="addr-city">City</FieldLabel>
          <Input id="addr-city" placeholder="San Francisco" />
        </Field>
        <Field>
          <FieldLabel htmlFor="addr-zip">ZIP</FieldLabel>
          <Input id="addr-zip" placeholder="94103" />
        </Field>
      </FieldGroup>
    </FieldSet>
  ),
};

/**
 * `<FieldLegend variant="label">` matches `<FieldLabel>` typography — use when
 * the legend functions as an inline label rather than a section header.
 */
export const FieldSetLegendAsLabel: Story = {
  render: () => (
    <FieldSet className="max-w-md">
      <FieldLegend variant="label">Notification preferences</FieldLegend>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="np-email">Email</FieldLabel>
          <Input id="np-email" type="email" placeholder="you@example.com" />
        </Field>
      </FieldGroup>
    </FieldSet>
  ),
};

/**
 * Setting `data-disabled` on the Field dims label and description via the
 * `group-data-[disabled=true]/field:opacity-50` selectors.
 */
export const DisabledField: Story = {
  render: () => (
    <Field data-disabled="true" className="max-w-md">
      <FieldLabel htmlFor="dis-name">Display name</FieldLabel>
      <Input id="dis-name" disabled defaultValue="Jane Doe" />
      <FieldDescription>
        You can edit this from account settings.
      </FieldDescription>
    </Field>
  ),
};
