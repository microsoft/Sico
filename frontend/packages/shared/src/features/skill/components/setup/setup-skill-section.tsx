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

import { Button, Spinner } from "@sico/ui";
import {
  type ReactElement,
  type RefObject,
  useMemo,
  useRef,
  useState,
} from "react";

import { MessageState } from "../../../../components/message-state";
import { EMPTY_ILLUSTRATIONS } from "../../../../constants/empty-illustration";
import { useInfiniteScrollSentinel } from "../../../../hooks/use-infinite-scroll-sentinel";
import { SETUP_SKILLS_PAGE_SIZE } from "../../constants";
import { useUploadSkills } from "../../hooks/use-skill-mutations";
import { useSkillsInfiniteQuery } from "../../hooks/use-skills-query";
import { UploadSkillDialog } from "../dialogs/upload-skill-dialog";
import { SkillCardContainer } from "../skill-card-container";

// SKILL section for the Digital Worker setup. "Add skills" is disabled until an
// agent exists (create-mode has no agentId until Save creates it); once an
// agentId is present it opens the upload dialog and lists the agent's skills.
export function SetupSkillSection({
  agentId,
  rootRef,
}: {
  agentId?: string;
  // Local-scroll container the section lives in; forwarded to the infinite
  // scroll sentinel so it observes against that container, not the viewport.
  rootRef?: RefObject<HTMLElement | null>;
}): ReactElement {
  const [dialogOpen, setDialogOpen] = useState(false);
  const skills = useSkillsInfiniteQuery(
    { agentId: agentId ?? "", pageSize: SETUP_SKILLS_PAGE_SIZE },
    { enabled: Boolean(agentId) },
  );
  const { uploadFiles, uploading } = useUploadSkills(agentId ?? "");

  const items = useMemo(
    () => skills.data?.pages.flatMap((page) => page.items) ?? [],
    [skills.data],
  );
  const { isFetchingNextPage, hasNextPage, fetchNextPage } = skills;

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useInfiniteScrollSentinel(
    sentinelRef,
    {
      hasNextPage,
      isFetchingNextPage,
      fetchNextPage,
    },
    { rootRef },
  );

  const handleConfirm = async (files: File[]): Promise<void> => {
    const uploaded = await uploadFiles(files);
    if (uploaded) {
      setDialogOpen(false);
    }
  };

  let body: ReactElement | null;
  if (agentId && skills.isPending) {
    body = null;
  } else if (items.length > 0) {
    body = (
      <div className="flex flex-col gap-4">
        {items.map((skill) => (
          <SkillCardContainer key={skill.id} skill={skill} />
        ))}
        <div ref={sentinelRef} aria-hidden="true" />
        {isFetchingNextPage ? (
          <div className="flex w-full items-center justify-center py-6">
            <Spinner aria-label="Loading more" />
          </div>
        ) : null}
      </div>
    );
  } else {
    body = (
      <MessageState
        fill
        illustrationUrl={EMPTY_ILLUSTRATIONS.skills.url}
        illustrationWidth={EMPTY_ILLUSTRATIONS.skills.width}
        illustrationHeight={EMPTY_ILLUSTRATIONS.skills.height}
        heading="Empty List"
        body="No skills yet."
      />
    );
  }

  return (
    <section className="flex flex-1 flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-foreground-primary text-base font-medium">SKILL</h2>
        <Button
          variant="secondary"
          size="xs"
          disabled={!agentId || uploading}
          onClick={() => setDialogOpen(true)}
        >
          Add skills
        </Button>
      </div>
      {body}
      {agentId && (
        <UploadSkillDialog
          open={dialogOpen}
          mode="create"
          pending={uploading}
          onOpenChange={setDialogOpen}
          onConfirm={handleConfirm}
        />
      )}
    </section>
  );
}
