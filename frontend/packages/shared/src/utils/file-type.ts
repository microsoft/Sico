// Filename parsing — pure string helpers, zero React/icon dependency. The
// icon mapping that builds on these lives in `file-icon.tsx`.

const IMAGE_EXTENSIONS = new Set([
  "svg",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "webp",
]);

// The lowercased extension (text after the last `.`), or "" when there is none.
export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

// Image attachments render as an inline thumbnail, not a file-type icon (§4).
export function isImageFilename(filename: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(filename));
}

// A link import has no meaningful extension (its "extension" would be parsed
// from the URL path/host and mislead — `…/doc.pdf` → pdf, `…/page` → File), so
// detect the URL form first.
export function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}
