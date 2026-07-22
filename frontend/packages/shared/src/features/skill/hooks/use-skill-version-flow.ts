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

import { useCallback, useState } from "react";

import { useSkillDetailQuery } from "./use-skill-detail-query";
import { useSkillStatusSync } from "./use-skill-status-sync";
import {
  type SkillItem,
  type SkillStatus,
  SkillStatusSchema,
  type SkillVersion,
} from "../schemas/skill";

export type SkillVersionFlow = {
  detail: ReturnType<typeof useSkillDetailQuery>;
  parsing: boolean;
  selectedVersion: string;
  selectVersion: (version: string) => void;
  startParsingVersion: (version: string) => void;
  versions: SkillVersion[];
};

type ParseLifecycle = {
  parsing: boolean;
  pendingVersion: string | undefined;
  settlingVersion: string | undefined;
  onStatusSettled: (status: SkillStatus) => void;
  startParsing: (version: string) => void;
  adoptSettled: () => void;
};

// The parse-lifecycle state a skill card threads through, plus the transitions
// that mutate it: the version we're polling (`pendingVersion`), the parsed
// version waiting to be adopted once its detail lands (`settlingVersion`), and
// the `parsing` flag. Bundled here so the flow hook stays a thin orchestrator.
function useParseLifecycle(skill: SkillItem): ParseLifecycle {
  const [parsing, setParsing] = useState(
    skill.status === SkillStatusSchema.enum.UPLOADING,
  );
  const [pendingVersion, setPendingVersion] = useState<string | undefined>();
  const [settlingVersion, setSettlingVersion] = useState<string | undefined>();

  const onStatusSettled = useCallback(
    (status: SkillStatus) => {
      // On success, fetch detail once via the settling version so the card —
      // even while collapsed — renders the parsed version's name/description. A
      // save/replace supplies pendingVersion; a fresh upload has none, so fall
      // back to the skill's own version. FAILED just stops parsing.
      if (status === SkillStatusSchema.enum.UPLOADED) {
        setSettlingVersion(pendingVersion ?? skill.version);
        return;
      }
      setPendingVersion(undefined);
      setSettlingVersion(undefined);
      setParsing(false);
    },
    [pendingVersion, skill.version],
  );
  const startParsing = useCallback((version: string) => {
    setPendingVersion(version);
    setParsing(true);
  }, []);
  const adoptSettled = useCallback(() => {
    setPendingVersion(undefined);
    setSettlingVersion(undefined);
    setParsing(false);
  }, []);

  return {
    parsing,
    pendingVersion,
    settlingVersion,
    onStatusSettled,
    startParsing,
    adoptSettled,
  };
}

// Render-phase reconciliation of which version the card shows. Returns a
// "settle" (the just-parsed version has landed — adopt it and clear parse
// flags), a "select" (no parse in flight and the current selection fell out of
// the list — fall back to newest), or null when nothing changes. Pure so the
// transition is explicit rather than inline set-state during render.
function resolveVersionSelection(input: {
  versions: SkillVersion[];
  selectedVersion: string;
  pendingVersion: string | undefined;
  settlingVersion: string | undefined;
  parsing: boolean;
  detailReady: boolean;
}): { type: "settle" | "select"; version: string } | null {
  const { versions, selectedVersion, settlingVersion, pendingVersion } = input;
  const inList = (v: string): boolean =>
    versions.some((entry) => entry.version === v);

  if (settlingVersion && inList(settlingVersion) && input.detailReady) {
    return { type: "settle", version: settlingVersion };
  }
  const newestVersion = versions[0];
  if (
    !pendingVersion &&
    !settlingVersion &&
    !input.parsing &&
    newestVersion &&
    !inList(selectedVersion)
  ) {
    return { type: "select", version: newestVersion.version };
  }
  return null;
}

// Coordinates a skill card's version selection with the parse lifecycle: which
// version is shown, whether we're mid-parse, and the settle-to-newest handoff
// once a save/replace/upload finishes parsing. Extracted from SkillCardContainer
// so the container stays presentational.
export function useSkillVersionFlow(
  skill: SkillItem,
  expanded: boolean,
): SkillVersionFlow {
  const [selectedVersion, setSelectedVersion] = useState(skill.version);
  const flow = useParseLifecycle(skill);
  const detail = useSkillDetailQuery(skill.id, {
    enabled: expanded || Boolean(flow.settlingVersion),
  });
  const versions = detail.data?.versions ?? [];

  useSkillStatusSync({
    skill,
    version: flow.pendingVersion ?? skill.version,
    parsing: flow.parsing,
    onSettled: flow.onStatusSettled,
  });

  const next = resolveVersionSelection({
    versions,
    selectedVersion,
    pendingVersion: flow.pendingVersion,
    settlingVersion: flow.settlingVersion,
    parsing: flow.parsing,
    detailReady: detail.isSuccess && !detail.isFetching,
  });
  if (next) {
    setSelectedVersion(next.version);
    if (next.type === "settle") {
      flow.adoptSettled();
    }
  }

  return {
    detail,
    parsing: flow.parsing,
    selectVersion: setSelectedVersion,
    selectedVersion,
    startParsingVersion: flow.startParsing,
    versions,
  };
}
