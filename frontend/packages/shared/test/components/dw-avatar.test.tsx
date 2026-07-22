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

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DwAvatar } from "@/components/dw-avatar";

describe("<DwAvatar>", () => {
  const agent = { iconUri: "https://example.test/a.png" };
  const label = "Atlas Agent";

  it("renders <AvatarImage> when iconUri is provided", () => {
    render(<DwAvatar agent={agent} label={label} />);
    const imgs = screen.getAllByAltText(label);
    expect(imgs.length).toBeGreaterThan(0);
  });

  it("renders only the default DW fallback when iconUri is missing", () => {
    render(<DwAvatar agent={{}} label={label} />);
    const imgs = screen.getAllByAltText(label);
    expect(imgs).toHaveLength(1);
    expect(imgs[0]?.getAttribute("src")).toBeTruthy();
  });

  it("sets empty alt when decorative", () => {
    render(<DwAvatar agent={agent} decorative />);
    expect(screen.queryByAltText(label)).toBeNull();
  });

  it("forwards size to Avatar via data-size", () => {
    render(<DwAvatar agent={agent} label={label} size="xs" />);
    const root = screen.getByTestId("avatar-root");
    expect(root.getAttribute("data-size")).toBe("xs");
  });

  it("defaults size to 'default'", () => {
    render(<DwAvatar agent={agent} label={label} />);
    const root = screen.getByTestId("avatar-root");
    expect(root.getAttribute("data-size")).toBe("default");
  });
});
