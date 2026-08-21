import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import type { SkillFile } from "../schemas/skill";
import {
  assertSafeAssetUrl,
  buildSkillFilesFromDownload,
  readWithProgress,
} from "../utils/file-utils";

type ZipState = {
  files: SkillFile[];
  isLoading: boolean;
  progress: number;
  error: string;
};

// Stable reference for the not-yet-loaded state so consumers relying on
// referential equality (e.g. the edit-buffer baseline guard) don't churn on
// every render while the download is pending.
const EMPTY_FILES: SkillFile[] = [];

// Downloads the asset at `url` and decodes it into preview files (zip archive or
// single file). Keyed by url through react-query so repeated mounts / detail
// invalidations reuse the cached result instead of re-downloading.
export function useZipFiles(url: string | undefined): ZipState {
  const [progress, setProgress] = useState(0);
  const query = useQuery({
    queryKey: ["skill-zip-files", url],
    enabled: Boolean(url),
    staleTime: 5 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: false,
    queryFn: async ({ signal }): Promise<SkillFile[]> => {
      if (url === undefined) {
        throw new Error("Missing file url");
      }
      setProgress(0);
      const response = await fetch(assertSafeAssetUrl(url), { signal });
      if (!response.ok) {
        throw new Error(`Failed to load file (${response.status})`);
      }
      const buffer = await readWithProgress(response, setProgress);
      return buildSkillFilesFromDownload(buffer, url);
    },
  });

  return {
    files: query.data ?? EMPTY_FILES,
    isLoading: Boolean(url) && query.isPending,
    progress: query.isSuccess ? 1 : progress,
    error: query.error instanceof Error ? query.error.message : "",
  };
}
