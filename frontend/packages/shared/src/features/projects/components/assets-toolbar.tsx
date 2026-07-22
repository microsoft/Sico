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
  Button,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@sico/ui";
import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useState } from "react";
import type * as React from "react";

import type { AssetSearch } from "../schemas/asset-search";
import type { AssetCategory } from "../types";

// The four category tabs, now PATH-driven (`/project/$id` = all,
// `/project/$id/knowledge` etc.) rather than `?tab=`. `to` is relative to the
// `$projectId` layout; the index (all) targets the bare project path.
const CATEGORY_TABS: readonly {
  category: AssetCategory;
  label: string;
  to: string;
}[] = [
  { category: "all", label: "All", to: "/project/$projectId" },
  {
    category: "knowledge",
    label: "Knowledge",
    to: "/project/$projectId/knowledge",
  },
  {
    category: "deliverable",
    label: "Deliverable",
    to: "/project/$projectId/deliverable",
  },
  {
    category: "experience",
    label: "Experience",
    to: "/project/$projectId/experience",
  },
];

export type AssetsToolbarProps = {
  projectId: number;
  /** The active category (from the route path), highlights its tab. */
  category: AssetCategory;
  search: AssetSearch;
  onSearchChange: (next: Partial<AssetSearch>) => void;
  /** Opens the parent's Add Knowledge dialog. */
  onAddKnowledge: () => void;
};

/**
 * The assets table's toolbar row (frame `19456-11535`): the category Tabs (pill
 * variant) on the left, now rendered as router `<Link>`s so each tab is a real
 * URL (`/project/$id/knowledge`) — the active one derives from the route path,
 * not local state. On the right: the collapsible 🔍 search + category-gated Add
 * Knowledge. Add Knowledge only adds Knowledge, so it shows on All/Knowledge
 * only. `searchOpen` is purely local UI state; the query itself stays in the URL
 * via `search`/`onSearchChange`.
 */
export function AssetsToolbar({
  projectId,
  category,
  search,
  onSearchChange,
  onAddKnowledge,
}: AssetsToolbarProps): React.JSX.Element {
  // Seed open when the URL already carries a query so a shared/back-button link
  // shows the active filter rather than a collapsed icon.
  const [searchOpen, setSearchOpen] = useState(search.q.trim() !== "");
  const showAddKnowledge = category === "all" || category === "knowledge";

  return (
    <div className="flex items-center justify-between gap-4">
      {/* The Tabs primitive supplies the pill styling; each trigger is a
          Link rendered via `render` so it navigates instead of toggling state. */}
      <Tabs value={category}>
        <TabsList variant="pill">
          {CATEGORY_TABS.map((tab) => (
            <TabsTrigger
              key={tab.category}
              value={tab.category}
              // The trigger renders a Link (an <a>), not a native <button>, so
              // tell Base UI to drop its native-button assumption (else it warns).
              nativeButton={false}
              render={
                <Link
                  to={tab.to}
                  params={{ projectId: String(projectId) }}
                  // Preserve sort/q across category switches (navigating between
                  // routes drops search by default; `search` carries it over).
                  search
                />
              }
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="flex items-center gap-2">
        {searchOpen ? (
          <InputGroup className="w-64">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Search assets"
              placeholder="Search assets"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- focus the field the user just revealed via the 🔍 toggle
              autoFocus
              value={search.q}
              onChange={(event) => onSearchChange({ q: event.target.value })}
              onBlur={() => {
                if (search.q.trim() === "") {
                  setSearchOpen(false);
                }
              }}
            />
          </InputGroup>
        ) : (
          <Button
            variant="subtle"
            size="icon-sm"
            aria-label="Search assets"
            onClick={() => setSearchOpen(true)}
          >
            <Search />
          </Button>
        )}
        {showAddKnowledge ? (
          <Button variant="primary" onClick={onAddKnowledge}>
            Add Knowledge
          </Button>
        ) : null}
      </div>
    </div>
  );
}
