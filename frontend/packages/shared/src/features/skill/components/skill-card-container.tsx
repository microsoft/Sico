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

import { toast } from "@sico/ui";
import { type ReactElement, useState } from "react";

import { useSkillCardActions } from "../hooks/use-skill-card-actions";
import { useDeleteSkillMutation } from "../hooks/use-skill-mutations";
import { useSkillVersionFlow } from "../hooks/use-skill-version-flow";
import { type SkillItem } from "../schemas/skill";
import { findActiveVersion } from "../utils";
import { DeleteSkillDialog } from "./dialogs/delete-skill-dialog";
import { UploadSkillDialog } from "./dialogs/upload-skill-dialog";
import { useZipFiles } from "../hooks/use-zip-files";
import { SkillCard } from "./skill-list/skill-card";

export function SkillCardContainer({
  skill,
}: {
  skill: SkillItem;
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  // Version minted by a save/replace. We poll its status, refetch detail on
  // UPLOADED, then select it + hide parsing only once it's in the list — so the
  // card stays on "Parsing ..." straight through to the new version's content.
  const {
    detail,
    parsing,
    selectVersion,
    selectedVersion,
    startParsingVersion,
    versions,
  } = useSkillVersionFlow(skill, expanded);
  const deleteSkill = useDeleteSkillMutation();

  const activeVersion = findActiveVersion(versions, selectedVersion);
  // Files live at version.url (a zip or single asset) and are fetched
  // client-side; fall back to any inline files (legacy `zipUrl ? zip : files`).
  const download = useZipFiles(activeVersion?.url);
  const originalFiles = activeVersion?.url
    ? download.files
    : (activeVersion?.files ?? []);

  const actions = useSkillCardActions(
    skill,
    selectedVersion,
    activeVersion,
    (version) => {
      setReplaceOpen(false);
      startParsingVersion(version);
    },
  );

  // Saving mints a new version; once save returns we poll the new version and
  // show the parsing state until it lands (legacy onSaveChangeButtonClick).
  const handleSave = async (
    changes: Parameters<typeof actions.save>[0],
  ): Promise<void> => {
    const version = await actions.save(changes);
    if (version) {
      startParsingVersion(version);
    }
  };

  return (
    <>
      <SkillCard
        skill={skill}
        versions={versions}
        status={skill.status}
        parsing={parsing}
        detailLoading={expanded && detail.isPending}
        expanded={expanded}
        onToggle={() => setExpanded((prev) => !prev)}
        originalFiles={originalFiles}
        filesLoading={download.isLoading}
        filesProgress={download.progress}
        filesError={download.error}
        selectedVersion={selectedVersion}
        onSelectVersion={selectVersion}
        onReplace={() => setReplaceOpen(true)}
        onDownloadZip={actions.downloadZip}
        onDelete={() => setPendingDelete(true)}
        onSave={handleSave}
      />
      <DeleteSkillDialog
        open={pendingDelete}
        skillName={skill.name}
        pending={deleteSkill.isPending}
        onOpenChange={setPendingDelete}
        onConfirm={() =>
          deleteSkill.mutate(skill.id, {
            onSuccess: () => {
              toast.success("Skill deleted", { invert: true });
              setPendingDelete(false);
            },
            onError: () => toast.error("Failed to delete skill"),
          })
        }
      />
      <UploadSkillDialog
        open={replaceOpen}
        mode="replace"
        pending={actions.replacing}
        onOpenChange={setReplaceOpen}
        onConfirm={actions.replaceConfirm}
      />
    </>
  );
}
