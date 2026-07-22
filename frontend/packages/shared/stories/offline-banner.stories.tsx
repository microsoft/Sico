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
import { type ReactElement, useEffect, useState } from "react";

import { OfflineBanner } from "@/components/shell/offline-banner";

// Wrapper height for story stages; ensures the fixed-position banner is visible
// inside the Storybook canvas without forcing scroll. Stage uses `bg-background`
// to match the runtime surface utility used by route shells.
const STAGE_CLASSES = "bg-background relative min-h-32";

function setOnline(value: boolean): void {
  Object.defineProperty(navigator, "onLine", {
    value,
    configurable: true,
  });
  window.dispatchEvent(new Event(value ? "online" : "offline"));
}

function StageOnline(): ReactElement {
  useEffect((): (() => void) => {
    setOnline(true);
    return (): void => setOnline(true);
  }, []);
  return (
    <div className={STAGE_CLASSES}>
      <OfflineBanner />
    </div>
  );
}

function StageOffline(): ReactElement {
  useEffect((): (() => void) => {
    setOnline(false);
    return (): void => setOnline(true);
  }, []);
  return (
    <div className={STAGE_CLASSES}>
      <OfflineBanner />
    </div>
  );
}

function StageRestored(): ReactElement {
  const [offline, setOffline] = useState(true);
  useEffect((): (() => void) => {
    setOnline(!offline);
    const timer = setTimeout((): void => {
      setOffline(false);
    }, 2000);
    return (): void => {
      clearTimeout(timer);
      setOnline(true);
    };
  }, [offline]);
  return (
    <div className={STAGE_CLASSES}>
      <p className="text-foreground-secondary p-4 text-sm">
        Banner appears, then auto-dismisses after 2s when connection is
        restored.
      </p>
      <OfflineBanner />
    </div>
  );
}

// autodocs disabled: stages mutate global navigator.onLine; rendering them simultaneously causes effect races
const meta = {
  title: "Components/OfflineBanner",
  component: OfflineBanner,
} satisfies Meta<typeof OfflineBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Connection is up — banner stays hidden. */
export const Online: Story = {
  render: (): ReactElement => <StageOnline />,
};

/** Connection dropped — banner is shown and persists. */
export const Offline: Story = {
  render: (): ReactElement => <StageOffline />,
};

/** Connection comes back after 2s — banner auto-dismisses. */
export const Restored: Story = {
  render: (): ReactElement => <StageRestored />,
};
