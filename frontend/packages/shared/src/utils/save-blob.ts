// Save an in-memory blob to disk via a synthetic `<a download>`. The single
// home for the anchor/click/revoke dance so callers that already HAVE the bytes
// (markdown built client-side) and callers that FETCH them (`downloadFile`)
// share one correct implementation instead of duplicating it.
export function saveBlob(blob: Blob, filename: string): void {
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = filename;
  anchor.rel = "noopener noreferrer";
  // Append before click: a disconnected anchor's programmatic click is a no-op
  // in some browsers (Firefox).
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoke in the same tick: click() has already handed the blob to the
  // browser's download, so keeping the object URL alive would only leak (MI9).
  URL.revokeObjectURL(blobUrl);
}
