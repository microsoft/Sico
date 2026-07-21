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
