import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import CodeMirror, { EditorView, type Extension } from "@uiw/react-codemirror";
import type { ReactElement } from "react";

import type { SkillFile } from "../../schemas/skill";
import { detectLanguage } from "../../utils";

const LANGUAGE_EXTENSIONS: Record<string, Extension[]> = {
  json: [json()],
  markdown: [markdown()],
  python: [python()],
  yaml: [yaml()],
  javascript: [javascript({ jsx: true, typescript: true })],
  typescript: [javascript({ jsx: true, typescript: true })],
  html: [html()],
  css: [css()],
  xml: [xml()],
};

const NO_OUTLINE_THEME = EditorView.theme({
  "&.cm-focused": { outline: "none !important" },
  ".cm-content": { outline: "none !important" },
  ".cm-scroller": { outline: "none !important" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 16px 0 8px" },
});

// Editable code view backed by CodeMirror (matches the legacy CodeEditor):
// per-language syntax highlighting, line numbers, and soft wrapping. Read-only
// when not editable.
export function CodeViewer({
  file,
  editable,
  onChange,
}: {
  file: SkillFile;
  editable: boolean;
  onChange?: (content: string) => void;
}): ReactElement {
  const language = detectLanguage(file.path);
  const extensions: Extension[] = [
    EditorView.lineWrapping,
    NO_OUTLINE_THEME,
    ...(LANGUAGE_EXTENSIONS[language] ?? []),
  ];

  return (
    <CodeMirror
      className="text-foreground-emphasis [&_.cm-lineNumbers_.cm-gutterElement]:text-foreground-tertiary h-full text-xs [&_.cm-editor]:h-full [&_.cm-gutters]:!border-r-0 [&_.cm-gutters]:!bg-transparent [&_.cm-lineNumbers_.cm-gutterElement]:text-xs [&_.cm-scroller]:p-0"
      value={file.content}
      readOnly={!editable}
      editable={editable}
      height="100%"
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
      }}
      extensions={extensions}
      onChange={(value) => onChange?.(value)}
    />
  );
}
