import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "../src/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../src/components/ui/dialog";

/**
 * Modal dialog built on the Base UI Dialog primitive. `DialogContent` takes a
 * `variant` (`confirmation` | `content`) that picks a size preset and an
 * optional `showCloseButton`. Compose it with `DialogHeader`, `DialogTitle`,
 * `DialogDescription`, and `DialogFooter`. Click a trigger to open each demo.
 */
const meta = {
  title: "Components/Dialog",
  component: DialogContent,
  parameters: { layout: "centered" },
  args: {
    variant: "confirmation",
    showCloseButton: true,
  },
} satisfies Meta<typeof DialogContent>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Confirmation preset (`variant="confirmation"`) — a 600px-wide card with a
 * text body and Discard / Cancel / Save actions. Drives the Controls panel.
 */
export const Confirmation: Story = {
  render: (args) => (
    <Dialog>
      <DialogTrigger render={<Button variant="secondary" />}>
        Open dialog
      </DialogTrigger>
      <DialogContent {...args}>
        <DialogHeader>
          <DialogTitle>Unsaved changes</DialogTitle>
          <DialogDescription>
            Do you want to save the changes to your digital worker before
            leaving?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:justify-between">
          <Button variant="destructive-outline">Discard changes</Button>
          <div className="flex gap-2">
            <DialogClose render={<Button variant="secondary" />}>
              Cancel
            </DialogClose>
            <Button>Save</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

/**
 * Content preset (`variant="content"`) — a wider 440–960px card whose body is
 * a free slot for forms, media, or custom content.
 */
export const Content: Story = {
  args: { variant: "content" },
  render: (args) => (
    <Dialog>
      <DialogTrigger render={<Button variant="secondary" />}>
        Open dialog
      </DialogTrigger>
      <DialogContent {...args}>
        <DialogHeader>
          <DialogTitle>Edit configuration</DialogTitle>
          <DialogDescription>
            Adjust the worker settings, then save your changes.
          </DialogDescription>
        </DialogHeader>
        <div className="bg-surface-sunken h-24 w-full rounded-sm" />
        <DialogFooter>
          <DialogClose render={<Button variant="secondary" />}>
            Cancel
          </DialogClose>
          <Button>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

/**
 * Dismiss-only — a single acknowledging action that closes the dialog. Use for
 * terminal notices such as an expired session.
 */
export const DismissOnly: Story = {
  render: (args) => (
    <Dialog>
      <DialogTrigger render={<Button variant="secondary" />}>
        Open dialog
      </DialogTrigger>
      <DialogContent {...args}>
        <DialogHeader>
          <DialogTitle>Session expired</DialogTitle>
          <DialogDescription>
            Your session has timed out. Please log in again to continue.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button />}>Log in</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

/**
 * `showCloseButton={false}` removes the top-right icon button, forcing the user
 * to resolve the dialog through an explicit footer action.
 */
export const WithoutCloseButton: Story = {
  args: { showCloseButton: false },
  render: (args) => (
    <Dialog>
      <DialogTrigger render={<Button variant="secondary" />}>
        Open dialog
      </DialogTrigger>
      <DialogContent {...args}>
        <DialogHeader>
          <DialogTitle>Confirm deletion</DialogTitle>
          <DialogDescription>This action cannot be undone.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="secondary" />}>
            Cancel
          </DialogClose>
          <Button variant="destructive-outline">Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

/**
 * `DialogFooter`'s own `showCloseButton` prop appends a built-in secondary
 * "Close" action — the upstream convenience, restyled to the SICO `secondary`
 * button. The top-right icon is disabled here so this is the only dismissal.
 */
export const FooterCloseButton: Story = {
  args: { showCloseButton: false },
  render: (args) => (
    <Dialog>
      <DialogTrigger render={<Button variant="secondary" />}>
        Open dialog
      </DialogTrigger>
      <DialogContent {...args}>
        <DialogHeader>
          <DialogTitle>Release notes</DialogTitle>
          <DialogDescription>
            Version 2.4 adds scheduled runs and per-step retries.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  ),
};
