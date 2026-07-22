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
import type * as React from "react";

function FontPreview(): React.JSX.Element {
  return (
    <div className="flex max-w-2xl flex-col gap-8 p-8">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-foreground-emphasis text-2xl font-semibold">
          Geist Font Preview
        </h1>
        <p className="text-foreground-tertiary text-sm">
          Font family: var(--font-sans) → &quot;Geist&quot;, ui-sans-serif,
          system-ui, sans-serif
        </p>
      </div>

      {/* Weight scale */}
      <section className="flex flex-col gap-3">
        <h2 className="text-foreground-secondary text-sm font-medium tracking-wider uppercase">
          Weight Scale
        </h2>
        <div className="border-divider flex flex-col gap-2 rounded-xl border p-5">
          <p className="text-foreground-primary font-thin">
            Thin (100) — The quick brown fox jumps over the lazy dog
          </p>
          <p className="text-foreground-primary font-extralight">
            ExtraLight (200) — The quick brown fox jumps over the lazy dog
          </p>
          <p className="text-foreground-primary font-light">
            Light (300) — The quick brown fox jumps over the lazy dog
          </p>
          <p className="text-foreground-primary font-normal">
            Regular (400) — The quick brown fox jumps over the lazy dog
          </p>
          <p className="text-foreground-primary font-medium">
            Medium (500) — The quick brown fox jumps over the lazy dog
          </p>
          <p className="text-foreground-primary font-semibold">
            SemiBold (600) — The quick brown fox jumps over the lazy dog
          </p>
          <p className="text-foreground-primary font-bold">
            Bold (700) — The quick brown fox jumps over the lazy dog
          </p>
          <p className="text-foreground-primary font-extrabold">
            ExtraBold (800) — The quick brown fox jumps over the lazy dog
          </p>
          <p className="text-foreground-primary font-black">
            Black (900) — The quick brown fox jumps over the lazy dog
          </p>
        </div>
      </section>

      {/* Size scale */}
      <section className="flex flex-col gap-3">
        <h2 className="text-foreground-secondary text-sm font-medium tracking-wider uppercase">
          Size Scale
        </h2>
        <div className="border-divider flex flex-col gap-2 rounded-xl border p-5">
          <p className="text-2xs text-foreground-primary">
            text-2xs (10px) — Badge count, compact UI
          </p>
          <p className="text-foreground-primary text-xs">
            text-xs (12px) — Captions, timestamps
          </p>
          <p className="text-foreground-primary text-sm">
            text-sm (14px) — Body text, descriptions
          </p>
          <p className="text-foreground-primary text-base">
            text-base (16px) — Default paragraph text
          </p>
          <p className="text-foreground-primary text-lg">
            text-lg (18px) — Subheadings
          </p>
          <p className="text-foreground-primary text-xl">
            text-xl (20px) — Section headers
          </p>
          <p className="text-foreground-primary text-2xl">
            text-2xl (24px) — Page titles
          </p>
          <p className="text-foreground-primary text-3xl">
            text-3xl (30px) — Display text
          </p>
        </div>
      </section>

      {/* Tracking scale */}
      <section className="flex flex-col gap-3">
        <h2 className="text-foreground-secondary text-sm font-medium tracking-wider uppercase">
          Tracking (Letter-Spacing)
        </h2>
        <div className="border-divider flex flex-col gap-3 rounded-xl border p-5">
          <p className="text-foreground-emphasis text-3xl font-semibold tracking-tighter">
            Display: tracking-tighter (-0.02em)
          </p>
          <p className="text-foreground-primary text-xl font-medium tracking-tight">
            Heading: tracking-tight (-0.01em)
          </p>
          <p className="text-foreground-primary text-sm tracking-normal">
            Body: tracking-normal (0em) — The quick brown fox jumps over the
            lazy dog
          </p>
          <p className="text-foreground-secondary text-xs tracking-wide">
            Caption: tracking-wide (0.01em) — Labels, small text
          </p>
          <p className="text-foreground-tertiary text-xs font-medium tracking-wider uppercase">
            Badge / Table Head: tracking-wider (0.03em)
          </p>
        </div>
      </section>

      {/* Leading scale */}
      <section className="flex flex-col gap-3">
        <h2 className="text-foreground-secondary text-sm font-medium tracking-wider uppercase">
          Leading (Line-Height)
        </h2>
        <div className="border-divider flex flex-col gap-4 rounded-xl border p-5">
          <div>
            <p className="text-foreground-tertiary mb-1 text-xs">
              leading-display (1.15) — Headings
            </p>
            <p className="leading-display text-foreground-emphasis text-2xl font-semibold">
              Build Digital Workers that execute
              <br />
              real production work at scale
            </p>
          </div>
          <div>
            <p className="text-foreground-tertiary mb-1 text-xs">
              leading-body (1.5) — Body text
            </p>
            <p className="leading-body text-foreground-primary text-sm">
              The platform enables teams to create, manage, and evolve
              AI-powered workers that handle complex tasks autonomously. Each
              worker operates within defined guardrails while maintaining the
              flexibility to adapt to new situations.
            </p>
          </div>
          <div>
            <p className="text-foreground-tertiary mb-1 text-xs">
              leading-body-2 (1.6) — Long-form
            </p>
            <p className="leading-body-2 text-foreground-secondary text-base">
              Digital Workers represent a paradigm shift in how organizations
              approach automation. Unlike traditional bots that follow rigid
              scripts, these workers leverage contextual understanding to make
              nuanced decisions, collaborate with humans when needed, and
              continuously improve through feedback loops.
            </p>
          </div>
        </div>
      </section>

      {/* Semantic foreground colors */}
      <section className="flex flex-col gap-3">
        <h2 className="text-foreground-secondary text-sm font-medium tracking-wider uppercase">
          Foreground Hierarchy
        </h2>
        <div className="border-divider flex flex-col gap-2 rounded-xl border p-5">
          <p className="text-foreground-emphasis text-sm font-semibold">
            Emphasis — Page headings, highest weight
          </p>
          <p className="text-foreground-primary text-sm">
            Primary — Main body text, default reading
          </p>
          <p className="text-foreground-secondary text-sm">
            Secondary — Descriptions, supporting text
          </p>
          <p className="text-foreground-tertiary text-sm">
            Tertiary — Hints, timestamps, metadata
          </p>
          <p className="text-foreground-faint text-sm">
            Faint — Placeholders, disabled content
          </p>
        </div>
      </section>

      {/* Realistic UI sample */}
      <section className="flex flex-col gap-3">
        <h2 className="text-foreground-secondary text-sm font-medium tracking-wider uppercase">
          Realistic UI Sample
        </h2>
        <div className="border-divider flex flex-col gap-4 rounded-xl border p-5">
          {/* Card-like item */}
          <div className="border-stroke-subtle-card-rest shadow-s flex flex-col gap-2 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-foreground-emphasis text-sm font-medium">
                Digital Worker: QA Automator
              </h3>
              <span className="text-foreground-tertiary text-xs">
                2 min ago
              </span>
            </div>
            <p className="leading-body-2 text-foreground-secondary text-sm">
              Running automated browser tests on the staging environment. 12
              test cases passed, 2 warnings detected in performance metrics.
            </p>
            <div className="flex gap-2">
              <span className="bg-status-success-fill text-status-success-on-fill-foreground rounded-md px-2 py-0.5 text-xs font-medium">
                Passed
              </span>
              <span className="bg-status-warning-fill text-status-warning-foreground rounded-md px-2 py-0.5 text-xs font-medium">
                2 Warnings
              </span>
            </div>
          </div>

          {/* Chat bubble sample */}
          <div className="flex flex-col gap-3 pt-2">
            <div className="flex flex-col items-end gap-1 pl-16">
              <div className="bg-surface-sunken leading-body-2 text-foreground-primary max-w-xs rounded-2xl rounded-br-md px-4 py-3 text-sm shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                Can you summarize the test results?
              </div>
              <span className="text-foreground-faint text-xs">12:30</span>
            </div>
            <div className="flex flex-col items-start gap-1">
              <div className="leading-body-2 text-foreground-secondary max-w-xs text-sm">
                All 12 functional tests passed. The 2 warnings are related to
                page load time exceeding the 3s threshold on the dashboard
                route.
              </div>
              <span className="text-foreground-faint text-xs">12:31</span>
            </div>
          </div>
        </div>
      </section>

      {/* Numbers & monospace */}
      <section className="flex flex-col gap-3">
        <h2 className="text-foreground-secondary text-sm font-medium tracking-wider uppercase">
          Numbers & Tabular Data
        </h2>
        <div className="border-divider flex flex-col gap-2 rounded-xl border p-5">
          <p className="text-foreground-primary text-sm">
            Proportional: 1,234,567.89 — $42.00 — 99.7%
          </p>
          <p className="text-foreground-primary font-mono text-sm">
            Monospace: 1,234,567.89 — $42.00 — 99.7%
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
            <div className="text-foreground-tertiary">Requests</div>
            <div className="text-foreground-tertiary">Latency</div>
            <div className="text-foreground-tertiary">Status</div>
            <div className="text-foreground-primary font-medium">12,847</div>
            <div className="text-foreground-primary font-medium">142ms</div>
            <div className="text-status-success-foreground font-medium">
              Healthy
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

const meta = {
  title: "Preview/Font — Geist",
  component: FontPreview,
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof FontPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
