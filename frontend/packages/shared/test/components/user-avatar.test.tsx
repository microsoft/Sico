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

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { UserAvatar } from "@/components/user-avatar";

describe("<UserAvatar>", () => {
  it("renders <AvatarImage> when iconUri is provided", () => {
    // Base UI's AvatarImage only mounts <img> after image load fires.
    class StubImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 1;
      complete = true;
      set src(_: string) {
        // No-op: `complete=true` triggers Base UI's fast-path to 'loaded'.
      }
    }
    const originalImage = window.Image;
    // @ts-expect-error -- jsdom stub for Base UI AvatarImage fast-path
    window.Image = StubImage;
    try {
      render(
        <UserAvatar
          user={{ name: "Shuyu Mao", iconUri: "https://example.test/a.png" }}
        />,
      );
      const img = screen.getByAltText("Shuyu Mao");
      expect(img.getAttribute("src")).toBe("https://example.test/a.png");
    } finally {
      window.Image = originalImage;
    }
  });

  it("renders 2-letter upper-case initials when name has multiple capitals", () => {
    render(<UserAvatar user={{ name: "Shuyu Mao" }} />);
    screen.getByText("SM");
  });

  it("falls back to first two letters upper-cased when name has no capitals", () => {
    render(<UserAvatar user={{ name: "john doe" }} />);
    screen.getByText("JO");
  });

  it("renders '?' for empty seed", () => {
    render(<UserAvatar user={{}} />);
    screen.getByText("?");
  });

  it("sets empty alt when decorative=true", () => {
    render(
      <UserAvatar
        user={{ name: "Shuyu Mao", iconUri: "https://example.test/a.png" }}
        decorative
      />,
    );
    expect(screen.queryByAltText("Shuyu Mao")).toBeNull();
  });

  it("picks a hash-stable color: same name → same backgroundColor across renders", () => {
    const { container: a } = render(
      <UserAvatar user={{ name: "Shuyu Mao" }} />,
    );
    const { container: b } = render(
      <UserAvatar user={{ name: "Shuyu Mao" }} />,
    );
    const fallbackA = within(a).getByTestId("avatar-fallback");
    const fallbackB = within(b).getByTestId("avatar-fallback");
    expect(fallbackA.style.backgroundColor).not.toBe("");
    expect(fallbackA.style.backgroundColor).toBe(
      fallbackB.style.backgroundColor,
    );
  });

  it("falls back to email local-part when name absent", () => {
    render(<UserAvatar user={{ email: "shuyu@sico.ai" }} />);
    // "shuyu" → no uppers → slice(0,2).toUpperCase() = "SH"
    screen.getByText("SH");
  });

  it("forwards size to Avatar via data-size", () => {
    render(<UserAvatar user={{ name: "Shuyu Mao" }} size="xs" />);
    const root = screen.getByTestId("avatar-root");
    expect(root.getAttribute("data-size")).toBe("xs");
  });

  it("defaults size to 'default'", () => {
    render(<UserAvatar user={{ name: "Shuyu Mao" }} />);
    const root = screen.getByTestId("avatar-root");
    expect(root.getAttribute("data-size")).toBe("default");
  });
});
