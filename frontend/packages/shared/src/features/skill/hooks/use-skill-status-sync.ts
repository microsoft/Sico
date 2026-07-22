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

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { SKILL_DETAIL_QUERY_KEY_PREFIX } from "./use-skill-detail-query";
import { useSkillStatusQuery } from "./use-skill-status-query";
import {
  type SkillItem,
  type SkillStatus,
  SkillStatusSchema,
} from "../schemas/skill";

// Maps a poll outcome onto a terminal status, or undefined if still pending.
// Exhausted polling (stuck past the attempt cap) counts as FAILED so the caller
// can leave its "Parsing …" state instead of hanging on a never-terminal status.
function resolveSettledStatus(
  status: SkillStatus | undefined,
  isExhausted: boolean,
): SkillStatus | undefined {
  if (
    status === SkillStatusSchema.enum.UPLOADED ||
    status === SkillStatusSchema.enum.FAILED
  ) {
    return status;
  }
  return isExhausted ? SkillStatusSchema.enum.FAILED : undefined;
}

// Polls /skills/status while a skill is parsing and, on a terminal status,
// invalidates the skill's detail cache (so the new version's data lands) and
// reports the terminal status. The list cache is intentionally NOT touched here:
// save/replace only mutate the current skill and the caller re-reads it via the
// returned version, so the list is refreshed only on page load or on add.
export function useSkillStatusSync({
  skill,
  version,
  parsing,
  onSettled,
}: {
  skill: SkillItem;
  version: string;
  parsing: boolean;
  onSettled: (status: SkillStatus) => void;
}): void {
  const queryClient = useQueryClient();
  const { data: status, isExhausted } = useSkillStatusQuery({
    id: skill.id,
    version,
    enabled: parsing,
  });

  useEffect(() => {
    if (!parsing) {
      return;
    }
    const settled = resolveSettledStatus(status, isExhausted);
    if (settled === undefined) {
      return;
    }
    void queryClient.invalidateQueries({
      queryKey: [SKILL_DETAIL_QUERY_KEY_PREFIX, skill.id],
    });
    onSettled(settled);
  }, [status, isExhausted, parsing, skill.id, queryClient, onSettled]);
}
