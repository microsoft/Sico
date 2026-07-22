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

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@sico/ui";
import type { ReactElement } from "react";

import type { Role } from "../../schemas/roles";

// `items` lets Base UI's <SelectValue> resolve the selected option's label
// (role.name) instead of echoing the raw value. `value || null` shows the
// placeholder when no role is chosen (Base UI treats null, not "", as empty).
// `alignItemWithTrigger={false}` anchors the popup below the trigger instead of
// overlaying the selected item on top of it (the native-select default).
export function RoleSelect({
  id,
  value,
  options,
  onChange,
  disabled,
}: {
  id?: string;
  value: string;
  options: Role[];
  onChange: (value: string) => void;
  disabled?: boolean;
}): ReactElement {
  const items = options.map((role) => ({
    value: role.value,
    label: role.name,
  }));
  return (
    <Select
      items={items}
      value={value || null}
      onValueChange={(next) => onChange(next ?? "")}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label="Role" className="w-full">
        <SelectValue placeholder="Select a role..." />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {options.map((role) => (
          <SelectItem key={role.value} value={role.value}>
            {role.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
