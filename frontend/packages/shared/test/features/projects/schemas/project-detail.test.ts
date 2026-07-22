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

import { describe, expect, it } from "vitest";

import { projectDetailSchema } from "@/features/projects/schemas/project";

const detail = {
  id: 1,
  name: "Atlas",
  description: "d",
  iconUrl: "",
  memberType: 1,
  agentInstances: [],
  ownerUsername: "alice",
  creatorUsername: "alice",
  operatorAdmins: ["bob", "carol"],
  createdAt: 1700000000000,
  updatedAt: 1700000001000,
};

describe("projectDetailSchema", () => {
  it("parses detail fields on top of the list shape", () => {
    const p = projectDetailSchema.parse(detail);
    expect(p.operatorAdmins).toEqual(["bob", "carol"]);
    expect(p.ownerUsername).toBe("alice");
  });
  it("defaults operatorAdmins to [] when absent", () => {
    const { operatorAdmins, ...rest } = detail;
    void operatorAdmins;
    expect(projectDetailSchema.parse(rest).operatorAdmins).toEqual([]);
  });
  it("coerces operatorAdmins: null to [] (Go empty slice → null; §6 dec 6)", () => {
    expect(
      projectDetailSchema.parse({ ...detail, operatorAdmins: null })
        .operatorAdmins,
    ).toEqual([]);
  });
  it("tolerates memberType: 0 (Go zero-value the detail endpoint marshals for an unset role; §8 A)", () => {
    const parsed = projectDetailSchema.parse({ ...detail, memberType: 0 });
    expect(parsed.memberType).toBe(0);
  });
});
