import type { SkillVersion } from "../schemas/skill";

// The version matching `selectedVersion`, falling back to the newest (first)
// version when the selection isn't present. Shared by the card, the version
// dropdown, and the container so the fallback rule stays in one place.
export function findActiveVersion(
  versions: SkillVersion[],
  selectedVersion: string,
): SkillVersion | undefined {
  return (
    versions.find((version) => version.version === selectedVersion) ??
    versions[0]
  );
}
