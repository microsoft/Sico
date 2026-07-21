import { logger } from "./logger";
import { safeIconUri } from "./safe-icon-uri";
import { saveBlob } from "./save-blob";

// Files at or below this size are fetched into a blob and saved locally; larger
// ones (or an unknown size) open in a new tab rather than buffering a big blob
// in memory. Ported from legacy FileDrawer (50 MB).
const MAX_INLINE_DOWNLOAD_BYTES = 50 * 1024 * 1024;

function openInNewTab(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Trigger a browser download for a file URL. The url is agent-authored and
 * untrusted, so it is scheme-gated through `safeIconUri` (http(s)/same-origin
 * only) FIRST — a poisoned `javascript:`/`data:` url can't smuggle a payload
 * into `fetch` or `window.open` (the same gate every sibling navigation uses).
 * A blocked url is logged and dropped. Otherwise a HEAD request sizes the file:
 * ≤50 MB is fetched as a blob and saved via a synthetic `<a download>`;
 * anything larger (or with no `content-length`) opens in a new tab instead of
 * holding a huge blob in memory. A non-ok response (e.g. an expired SAS 403,
 * which still resolves with a small XML error body) opens in a new tab too,
 * rather than saving the error body to disk under the file's name. Any network
 * failure falls back to the same new-tab open — logged, not swallowed — so the
 * user can still reach the file (or see the real server error).
 */
export async function downloadFile(
  fileUrl: string,
  filename: string,
): Promise<void> {
  const safeUrl = safeIconUri(fileUrl || undefined);
  if (!safeUrl) {
    logger.warn("file download blocked: unsafe url scheme", { fileUrl });
    return;
  }
  try {
    const head = await fetch(safeUrl, { method: "HEAD" });
    const contentLength = head.headers.get("content-length");
    const size = contentLength ? Number(contentLength) : null;
    // `fetch` only rejects on a network failure — an expired-SAS 403 / 404 still
    // resolves, carrying a small XML error body with a content-length that would
    // pass the size gate and be saved AS the file. Route a non-ok response (or a
    // missing/NaN/oversized length) to the new-tab open instead (mirrors the ok
    // guard in use-fetched-text).
    if (
      !head.ok ||
      size === null ||
      !Number.isFinite(size) ||
      size > MAX_INLINE_DOWNLOAD_BYTES
    ) {
      openInNewTab(safeUrl);
      return;
    }
    const response = await fetch(safeUrl);
    if (!response.ok) {
      openInNewTab(safeUrl);
      return;
    }
    saveBlob(await response.blob(), filename);
  } catch (error) {
    logger.warn("file download failed; opening in a new tab", error);
    openInNewTab(safeUrl);
  }
}
