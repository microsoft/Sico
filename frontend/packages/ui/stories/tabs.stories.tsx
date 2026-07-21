import type { Meta, StoryObj } from "@storybook/react-vite";
import { ActivityIcon, LayoutGridIcon, SettingsIcon } from "lucide-react";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../src/components/ui/tabs";

/**
 * `<Tabs>` is a restyle of `base-nova/tabs` on `@base-ui/react/tabs`.
 * Compose `<TabsList>` with `<TabsTrigger>` children and one
 * `<TabsContent>` per tab. `<TabsList variant>` switches between the
 * segmented `default` pill, the underlined `line`, and the standalone
 * `pill` style; `size` (`sm` 32px / `md` 40px) applies to every variant.
 */
type TabsStoryArgs = {
  variant: "default" | "line" | "pill";
  size: "sm" | "md";
  orientation: "horizontal" | "vertical";
};

const meta = {
  title: "Components/Tabs",
  render: ({ variant, size, orientation }) => (
    <Tabs defaultValue="overview" orientation={orientation}>
      <TabsList variant={variant} size={size}>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">Overview panel</TabsContent>
      <TabsContent value="activity">Activity panel</TabsContent>
      <TabsContent value="settings">Settings panel</TabsContent>
    </Tabs>
  ),
  args: {
    variant: "default",
    size: "sm",
    orientation: "horizontal",
  },
} satisfies Meta<TabsStoryArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default `variant` — the segmented pill on a muted track. Drives the
 * Controls panel; every other story only overrides the diff.
 */
export const Default: Story = {};

/**
 * `variant="line"` — transparent track with an active underline that
 * fills with the accent color. Pairs with page-level navigation.
 */
export const Line: Story = { args: { variant: "line" } };

/**
 * `variant="pill"` — standalone rounded triggers; rest is transparent,
 * hover/selected fill with progressively stronger surface overlays.
 */
export const Pill: Story = { args: { variant: "pill" } };

/** `size="md"` — 40px row; the larger of the two for prominent tab bars. */
export const Medium: Story = { args: { size: "md" } };

/** `line` at `md` — taller underline bar; matches header navigation. */
export const LineMedium: Story = { args: { variant: "line", size: "md" } };

/** `pill` at `md` — roomier targets for the standalone pill bar. */
export const PillMedium: Story = { args: { variant: "pill", size: "md" } };

/**
 * A disabled trigger. The `disabled` prop comes straight from the Base
 * UI `Tabs.Tab` primitive; styling is the upstream `disabled:opacity-50`
 * utility.
 */
export const DisabledTab: Story = {
  render: ({ variant, size, orientation }) => (
    <Tabs defaultValue="overview" orientation={orientation}>
      <TabsList variant={variant} size={size}>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
        <TabsTrigger value="settings" disabled>
          Settings
        </TabsTrigger>
      </TabsList>
      <TabsContent value="overview">Overview panel</TabsContent>
      <TabsContent value="activity">Activity panel</TabsContent>
      <TabsContent value="settings">Settings panel</TabsContent>
    </Tabs>
  ),
};

/**
 * Triggers with a leading icon. Tag the icon element with
 * `data-icon="inline-start"` — the cva base applies `size-4` and tightens
 * the start padding via `has-data-[icon=inline-start]:pl-1`.
 */
export const WithIcon: Story = {
  render: ({ variant, size, orientation }) => (
    <Tabs defaultValue="overview" orientation={orientation}>
      <TabsList variant={variant} size={size}>
        <TabsTrigger value="overview">
          <LayoutGridIcon data-icon="inline-start" />
          Overview
        </TabsTrigger>
        <TabsTrigger value="activity">
          <ActivityIcon data-icon="inline-start" />
          Activity
        </TabsTrigger>
        <TabsTrigger value="settings">
          <SettingsIcon data-icon="inline-start" />
          Settings
        </TabsTrigger>
      </TabsList>
      <TabsContent value="overview">Overview panel</TabsContent>
      <TabsContent value="activity">Activity panel</TabsContent>
      <TabsContent value="settings">Settings panel</TabsContent>
    </Tabs>
  ),
};

/**
 * `orientation="vertical"` — the list stacks and the active indicator
 * moves to the trailing edge. Orientation is forwarded to `Tabs.Root`
 * untouched from upstream.
 */
export const Vertical: Story = { args: { orientation: "vertical" } };
