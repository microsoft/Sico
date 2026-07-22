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

import { ImageTile } from "@/components/image-tile";

// A self-contained sample thumbnail so the story needs no asset pipeline.
const SAMPLE_IMAGE = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120">
       <rect width="160" height="120" fill="#6366f1" />
       <circle cx="120" cy="36" r="20" fill="#fbbf24" />
       <path d="M0 120 L56 64 L96 104 L128 76 L160 108 L160 120 Z" fill="#34d399" />
     </svg>`,
)}`;

const meta = {
  title: "Components/ImageTile",
  component: ImageTile,
  tags: ["autodocs"],
  parameters: {
    // `src` is a self-contained sample data-URI (above) so the story needs no
    // asset pipeline; the dynamic snapshot would dump the whole percent-encoded
    // blob. Pin the snippet to a clean call with a placeholder URL instead.
    docs: {
      source: {
        code: '<ImageTile src="/landscape.png" alt="Landscape thumbnail" onRemove={onRemove} />',
      },
    },
  },
  args: {
    src: SAMPLE_IMAGE,
    alt: "Landscape thumbnail",
    status: "ready",
    onRemove: () => {},
  },
} satisfies Meta<typeof ImageTile>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Resting state — a fixed 44×44 thumbnail (object-cover); the remove pill is
 *  revealed on hover / focus-within and overlays the image's top-right corner. */
export const Ready: Story = {};

/** Upload in flight — a frosted scrim + spinner covers the decoded image while
 *  the thumbnail stays mounted underneath. */
export const Loading: Story = {
  args: { status: "loading" },
  parameters: {
    docs: {
      source: {
        code: '<ImageTile src="/landscape.png" alt="Landscape thumbnail" status="loading" onRemove={onRemove} />',
      },
    },
  },
};

/** Activatable — a sent image attachment whose surface is a button (click +
 *  Enter/Space) that opens the sidepane preview. No remove pill: read-only
 *  except for activation. */
export const Activatable: Story = {
  args: { onRemove: undefined, onActivate: () => {} },
  parameters: {
    docs: {
      source: {
        code: '<ImageTile src="/landscape.png" alt="Landscape thumbnail" onActivate={onActivate} />',
      },
    },
  },
};
