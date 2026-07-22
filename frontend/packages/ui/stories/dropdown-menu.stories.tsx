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
  FlagIcon,
  MessageCircleIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { type ReactElement, useState } from "react";

import { Button } from "../src/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../src/components/ui/dropdown-menu";

type DemoVariant =
  | "actions"
  | "single-select"
  | "with-badges"
  | "destructive"
  | "disabled"
  | "checkbox"
  | "submenu";

type StoryArgs = {
  variant: DemoVariant;
  triggerLabel: string;
};

function Demo({ variant, triggerLabel }: StoryArgs): ReactElement {
  switch (variant) {
    case "single-select":
      return <SingleSelectDemo triggerLabel={triggerLabel} />;
    case "with-badges":
      return <WithBadgesDemo triggerLabel={triggerLabel} />;
    case "destructive":
      return <DestructiveDemo triggerLabel={triggerLabel} />;
    case "disabled":
      return <DisabledDemo triggerLabel={triggerLabel} />;
    case "checkbox":
      return <CheckboxDemo triggerLabel={triggerLabel} />;
    case "submenu":
      return <SubmenuDemo triggerLabel={triggerLabel} />;
    case "actions":
    default:
      return <ActionsDemo triggerLabel={triggerLabel} />;
  }
}

function ActionsDemo({ triggerLabel }: { triggerLabel: string }): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="secondary" />}>
        {triggerLabel}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-auto max-w-[244px]">
        <DropdownMenuGroup>
          <DropdownMenuItem>
            <MessageCircleIcon />
            Human Take Over
          </DropdownMenuItem>
          <DropdownMenuItem>
            <PlusIcon />
            Add to train data
          </DropdownMenuItem>
          <DropdownMenuItem>
            <FlagIcon />
            Flag
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SingleSelectDemo({
  triggerLabel,
}: {
  triggerLabel: string;
}): ReactElement {
  const [value, setValue] = useState("arena");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="secondary" />}>
        {triggerLabel}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-96">
        <DropdownMenuRadioGroup value={value} onValueChange={setValue}>
          <DropdownMenuRadioItem value="arena">
            Arena, Tester
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="alex">
            Alex, Copywriter
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="jordan">
            Jordan, Designer
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="sam">
            Sam, Developer
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="taylor">
            Taylor, Manager
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WithBadgesDemo({
  triggerLabel,
}: {
  triggerLabel: string;
}): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="secondary" />}>
        {triggerLabel}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[368px]">
        <DropdownMenuGroup>
          <DropdownMenuItem>
            <span className="flex-1">Importing a 4K Video</span>
            <span className="bg-danger-100 text-danger-800 rounded-full px-1.5 py-0.5 text-xs font-medium">
              Failed
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <span className="flex-1">Importing a 360 Video</span>
            <span className="bg-danger-100 text-danger-800 rounded-full px-1.5 py-0.5 text-xs font-medium">
              Failed
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <span className="flex-1">Importing a 1080p Video</span>
            <span className="bg-danger-100 text-danger-800 rounded-full px-1.5 py-0.5 text-xs font-medium">
              Failed
            </span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DestructiveDemo({
  triggerLabel,
}: {
  triggerLabel: string;
}): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="secondary" />}>
        {triggerLabel}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuItem>Rename</DropdownMenuItem>
          <DropdownMenuItem>Duplicate</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive">
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DisabledDemo({
  triggerLabel,
}: {
  triggerLabel: string;
}): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="secondary" />}>
        {triggerLabel}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuItem>Enabled item</DropdownMenuItem>
          <DropdownMenuItem disabled>Disabled item</DropdownMenuItem>
          <DropdownMenuItem>Another item</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CheckboxDemo({
  triggerLabel,
}: {
  triggerLabel: string;
}): ReactElement {
  const [showStatus, setShowStatus] = useState(true);
  const [showActivity, setShowActivity] = useState(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="secondary" />}>
        {triggerLabel}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuCheckboxItem
            checked={showStatus}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={(c) => {
              setShowStatus(Boolean(c));
            }}
          >
            Show status bar
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={showActivity}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={(c) => {
              setShowActivity(Boolean(c));
            }}
          >
            Show activity bar
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SubmenuDemo({ triggerLabel }: { triggerLabel: string }): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="secondary" />}>
        {triggerLabel}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuItem>New File</DropdownMenuItem>
          <DropdownMenuItem>Open</DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Share</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Copy link</DropdownMenuItem>
              <DropdownMenuItem>Email</DropdownMenuItem>
              <DropdownMenuItem>Slack</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* Real-API snippets pinned to each story's Docs "Show code" — the meta renders
   an internal <Demo> dispatcher driven by the synthetic `variant` arg, so without
   these autodocs would dump `<Demo variant=… />` instead of the public API. */
const actionsSource = `<DropdownMenu>
  <DropdownMenuTrigger render={<Button variant="secondary" />}>
    Actions
  </DropdownMenuTrigger>
  <DropdownMenuContent className="w-auto max-w-[244px]">
    <DropdownMenuGroup>
      <DropdownMenuItem>
        <MessageCircleIcon />
        Human Take Over
      </DropdownMenuItem>
      <DropdownMenuItem>
        <PlusIcon />
        Add to train data
      </DropdownMenuItem>
      <DropdownMenuItem>
        <FlagIcon />
        Flag
      </DropdownMenuItem>
    </DropdownMenuGroup>
  </DropdownMenuContent>
</DropdownMenu>`;

const singleSelectSource = `<DropdownMenu>
  <DropdownMenuTrigger render={<Button variant="secondary" />}>
    Select Agent
  </DropdownMenuTrigger>
  <DropdownMenuContent className="w-96">
    <DropdownMenuRadioGroup value={value} onValueChange={setValue}>
      <DropdownMenuRadioItem value="arena">Arena, Tester</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="alex">Alex, Copywriter</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="jordan">Jordan, Designer</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="sam">Sam, Developer</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="taylor">Taylor, Manager</DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  </DropdownMenuContent>
</DropdownMenu>`;

const withBadgesSource = `<DropdownMenu>
  <DropdownMenuTrigger render={<Button variant="secondary" />}>
    Select Task
  </DropdownMenuTrigger>
  <DropdownMenuContent className="w-[368px]">
    <DropdownMenuGroup>
      <DropdownMenuItem>
        <span className="flex-1">Importing a 4K Video</span>
        <span className="bg-danger-100 text-danger-800 rounded-full px-1.5 py-0.5 text-xs font-medium">
          Failed
        </span>
      </DropdownMenuItem>
      {/* …more items… */}
    </DropdownMenuGroup>
  </DropdownMenuContent>
</DropdownMenu>`;

const destructiveSource = `<DropdownMenu>
  <DropdownMenuTrigger render={<Button variant="secondary" />}>
    File actions
  </DropdownMenuTrigger>
  <DropdownMenuContent className="w-48">
    <DropdownMenuGroup>
      <DropdownMenuItem>Rename</DropdownMenuItem>
      <DropdownMenuItem>Duplicate</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive">
        <Trash2Icon />
        Delete
      </DropdownMenuItem>
    </DropdownMenuGroup>
  </DropdownMenuContent>
</DropdownMenu>`;

const disabledSource = `<DropdownMenu>
  <DropdownMenuTrigger render={<Button variant="secondary" />}>
    Menu with disabled
  </DropdownMenuTrigger>
  <DropdownMenuContent className="w-48">
    <DropdownMenuGroup>
      <DropdownMenuItem>Enabled item</DropdownMenuItem>
      <DropdownMenuItem disabled>Disabled item</DropdownMenuItem>
      <DropdownMenuItem>Another item</DropdownMenuItem>
    </DropdownMenuGroup>
  </DropdownMenuContent>
</DropdownMenu>`;

const checkboxSource = `<DropdownMenu>
  <DropdownMenuTrigger render={<Button variant="secondary" />}>
    View options
  </DropdownMenuTrigger>
  <DropdownMenuContent className="w-56">
    <DropdownMenuGroup>
      <DropdownMenuCheckboxItem checked={showStatus} onCheckedChange={setShowStatus}>
        Show status bar
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem checked={showActivity} onCheckedChange={setShowActivity}>
        Show activity bar
      </DropdownMenuCheckboxItem>
    </DropdownMenuGroup>
  </DropdownMenuContent>
</DropdownMenu>`;

const submenuSource = `<DropdownMenu>
  <DropdownMenuTrigger render={<Button variant="secondary" />}>
    File
  </DropdownMenuTrigger>
  <DropdownMenuContent className="w-56">
    <DropdownMenuGroup>
      <DropdownMenuItem>New File</DropdownMenuItem>
      <DropdownMenuItem>Open</DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>Share</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuItem>Copy link</DropdownMenuItem>
          <DropdownMenuItem>Email</DropdownMenuItem>
          <DropdownMenuItem>Slack</DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </DropdownMenuGroup>
  </DropdownMenuContent>
</DropdownMenu>`;

const meta = {
  title: "Components/DropdownMenu",
  parameters: { layout: "centered" },
  args: {
    variant: "actions",
    triggerLabel: "Actions",
  },
  argTypes: {
    variant: {
      control: "select",
      options: [
        "actions",
        "single-select",
        "with-badges",
        "destructive",
        "disabled",
        "checkbox",
        "submenu",
      ],
    },
  },
  render: (args) => <Demo {...args} />,
} satisfies Meta<StoryArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Default appearance — drives the Controls panel. */
export const Default: Story = {
  parameters: { docs: { source: { code: actionsSource } } },
};

/** Compact action menu with icons — triggered by a toolbar button. */
export const ActionMenu: Story = {
  args: { variant: "actions", triggerLabel: "Actions" },
  parameters: { docs: { source: { code: actionsSource } } },
};

/** Single-select list using radio items — selected item shows a trailing checkmark. */
export const SingleSelect: Story = {
  args: { variant: "single-select", triggerLabel: "Select Agent" },
  parameters: { docs: { source: { code: singleSelectSource } } },
};

/** Selection list with inline status badges at the trailing edge. */
export const WithBadges: Story = {
  args: { variant: "with-badges", triggerLabel: "Select Task" },
  parameters: { docs: { source: { code: withBadgesSource } } },
};

/** Destructive variant for irreversible actions — red text at rest, danger background on focus. */
export const Destructive: Story = {
  args: { variant: "destructive", triggerLabel: "File actions" },
  parameters: { docs: { source: { code: destructiveSource } } },
};

/** Disabled items have reduced opacity and no pointer events. */
export const Disabled: Story = {
  args: { variant: "disabled", triggerLabel: "Menu with disabled" },
  parameters: { docs: { source: { code: disabledSource } } },
};

/** Checkbox items with toggleable state — indicator appears when checked. */
export const CheckboxItems: Story = {
  args: { variant: "checkbox", triggerLabel: "View options" },
  parameters: { docs: { source: { code: checkboxSource } } },
};

/** Nested submenu — hover or focus the SubTrigger to reveal the nested DropdownMenuSubContent. */
export const Submenu: Story = {
  args: { variant: "submenu", triggerLabel: "File" },
  parameters: { docs: { source: { code: submenuSource } } },
};
