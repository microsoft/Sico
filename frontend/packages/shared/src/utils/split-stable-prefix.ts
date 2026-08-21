// Streaming-render boundary (§6.E7c): split growing `content` into a settled
// prefix (safe to memoize) and a live tail (re-parsed each SSE frame). Since
// fence-safety is a prefix property, one forward pass tracking fence state finds
// the last blank line outside any open fence — the safe split point.
export function splitStablePrefix(content: string): number {
  let fenceChar: "`" | "~" | null = null;
  let boundary = 0;
  let lineStart = 0;

  for (let i = 0; i <= content.length; i++) {
    if (i !== content.length && content[i] !== "\n") {
      continue;
    }
    const line = content.slice(lineStart, i);
    const opener = line.trimStart();
    if (fenceChar === null) {
      if (opener.startsWith("```")) {
        fenceChar = "`";
      } else if (opener.startsWith("~~~")) {
        fenceChar = "~";
      }
    } else if (opener.startsWith(fenceChar.repeat(3))) {
      fenceChar = null;
    }
    // A blank line that sits OUTSIDE any open fence settles every block before
    // it; the prefix through this blank line's newline is the new safe boundary.
    if (fenceChar === null && line.trim() === "" && i < content.length) {
      boundary = i + 1;
    }
    lineStart = i + 1;
  }
  return boundary;
}
