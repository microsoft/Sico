import { toast } from "@sico/ui";

import {
  useUpdateSkillMutation,
  useUploadSkillAssetMutation,
} from "./use-skill-mutations";
import {
  type SkillAction,
  type SkillFile,
  type SkillItem,
  type SkillVersion,
} from "../schemas/skill";
import { type UpdateSkillInput } from "../services/skills";
import { assertSafeAssetUrl } from "../utils";

export type SkillCardSaveInput = {
  files?: SkillFile[];
  actions?: SkillAction[];
};

export type SkillCardActions = {
  downloadZip: () => void;
  save: (changes: SkillCardSaveInput) => Promise<string | undefined>;
  replaceConfirm: (files: File[]) => void;
  replacing: boolean;
};

function triggerZipDownload(skill: SkillItem, version: SkillVersion): void {
  let href: string;
  try {
    href = assertSafeAssetUrl(version.url);
  } catch {
    // assertSafeAssetUrl rejected an off-scheme URL (e.g. javascript:).
    toast.error("This file can't be downloaded.");
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `${skill.name}-${version.version}.zip`;
  anchor.click();
}

// Single markdown skills round-trip as one SKILL.md file (legacy parity).
function buildUpdateInput(
  skill: SkillItem,
  currentVersion: string,
  changes: SkillCardSaveInput,
  activeVersion: SkillVersion | undefined,
): UpdateSkillInput {
  const isSingleMarkdown = Boolean(
    activeVersion?.url.toLowerCase().endsWith(".md"),
  );
  return {
    id: skill.id,
    currentVersion,
    files:
      changes.files && isSingleMarkdown
        ? changes.files.map((file) => ({ ...file, path: "SKILL.md" }))
        : changes.files,
    actions: changes.actions,
  };
}

async function saveWithToast(
  updateSkill: ReturnType<typeof useUpdateSkillMutation>,
  input: UpdateSkillInput,
): Promise<string | undefined> {
  const savingToastId = toast.loading("Saving changes ...");
  try {
    const result = await updateSkill.mutateAsync(input);
    toast.dismiss(savingToastId);
    toast.success("Skill saved", { invert: true });
    return result.version;
  } catch {
    toast.dismiss(savingToastId);
    toast.error("Failed to save skill");
    return undefined;
  }
}

// Mutation side of the skill card (legacy Skill.tsx onSaveChangeButtonClick /
// download / replace). Kept in a hook so SkillCardContainer stays presentational.
export function useSkillCardActions(
  skill: SkillItem,
  selectedVersion: string,
  activeVersion: SkillVersion | undefined,
  onReplaced: (version: string) => void,
): SkillCardActions {
  const updateSkill = useUpdateSkillMutation();
  const uploadAsset = useUploadSkillAssetMutation();

  const downloadZip = (): void => {
    if (activeVersion?.url) {
      triggerZipDownload(skill, activeVersion);
    }
  };

  const save = (changes: SkillCardSaveInput): Promise<string | undefined> =>
    saveWithToast(
      updateSkill,
      buildUpdateInput(skill, selectedVersion, changes, activeVersion),
    );

  const replaceConfirm = (files: File[]): void => {
    const file = files[0];
    if (!file) {
      return;
    }
    uploadAsset.mutate(file, {
      onSuccess: (assetId) => {
        updateSkill.mutate(
          { id: skill.id, currentVersion: selectedVersion, assetId },
          {
            onSuccess: (result) => {
              toast.success("Skill replaced", { invert: true });
              onReplaced(result.version);
            },
            onError: () => toast.error("Failed to replace skill"),
          },
        );
      },
      onError: () => toast.error("Failed to upload skill"),
    });
  };

  return {
    downloadZip,
    save,
    replaceConfirm,
    replacing: uploadAsset.isPending || updateSkill.isPending,
  };
}
