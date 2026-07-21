import type { Meta, StoryObj } from "@storybook/react-vite";

import { Badge, type BadgeColor } from "../src/components/ui/badge";

/* ============================================
   Shared helpers
   ============================================ */

function StateRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-col items-center gap-1.5">
      {children}
      <span className="text-foreground-tertiary text-xs">{label}</span>
    </div>
  );
}

/* ============================================
   Data
   ============================================ */

const COLORS: BadgeColor[] = ["green", "red", "orange", "blue", "gray"];

const labels: Record<BadgeColor, string> = {
  green: "Active",
  red: "Failed",
  orange: "Warning",
  blue: "Running",
  gray: "Inactive",
};

/* ============================================
   Meta
   ============================================ */

const meta = {
  title: "Components/Badge",
  component: Badge,
  parameters: { layout: "padded" },
  args: {
    children: "Badge",
    variant: "default",
    color: "green",
  },
  argTypes: {
    children: { control: "text" },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

/* ============================================
   Stories
   ============================================ */

/**
 * Default variant — filled pill with tinted background. Drives the Controls
 * panel; flip `variant` and `color` to preview every combination.
 */
export const Default: Story = {};

/**
 * Every color in the filled `default` variant — a 4px-rounded chip with a
 * tinted background. Used for categorical labels and status chips.
 */
export const AllColors: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6">
      <p className="text-foreground-secondary text-sm">
        Rounded pill with tinted background. Used for categorical labels and
        status chips.
      </p>
      <div className="bg-surface-canvas flex items-center gap-6 rounded-lg p-8">
        {COLORS.map((color) => (
          <StateRow key={color} label={color}>
            <Badge variant="default" color={color}>
              {labels[color]}
            </Badge>
          </StateRow>
        ))}
      </div>
    </div>
  ),
};

/**
 * Secondary variant — text-only, pair with a dot child for status indicators.
 */
export const Secondary: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6">
      <p className="text-foreground-secondary text-sm">
        Subtle text-only badge. Compose with a dot child for status indicators
        in tables and lists.
      </p>
      <div className="bg-surface-canvas flex items-center gap-6 rounded-lg p-8">
        {COLORS.map((color) => (
          <StateRow key={color} label={color}>
            <Badge variant="secondary" color={color}>
              {labels[color]}
            </Badge>
          </StateRow>
        ))}
      </div>
    </div>
  ),
};

const dotColorClasses: Record<BadgeColor, string> = {
  green: "bg-status-success-foreground",
  red: "bg-status-error-foreground",
  orange: "bg-status-warning-foreground",
  blue: "bg-status-info-foreground",
  gray: "bg-icon-secondary",
};

/**
 * Secondary with dot — consumer composes a dot child for status indication.
 */
export const WithDot: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6">
      <p className="text-foreground-secondary text-sm">
        Dot is consumer-composed as a child element — the Badge component does
        not bake it in.
      </p>
      <div className="bg-surface-canvas flex items-center gap-6 rounded-lg p-8">
        {COLORS.map((color) => (
          <StateRow key={color} label={color}>
            <Badge variant="secondary" color={color}>
              <span
                className={`size-1.5 shrink-0 rounded-full ${dotColorClasses[color]}`}
                aria-hidden="true"
              />
              {labels[color]}
            </Badge>
          </StateRow>
        ))}
      </div>
    </div>
  ),
};
