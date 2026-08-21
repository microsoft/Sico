// Pulls the document's own title (its first `# ` heading) out of markdown so the
// previewer header can show the article title instead of the raw filename.
export function firstMarkdownHeading(markdown: string): string | undefined {
  for (const line of markdown.split("\n")) {
    // An ATX H1 is a single leading `#` followed by a space; `## ` and deeper
    // are lower levels, so the negative lookahead skips them.
    const match = /^#(?!#)\s+(.+?)\s*#*\s*$/.exec(line.trim());
    if (match) {
      return match[1];
    }
  }
  return undefined;
}
