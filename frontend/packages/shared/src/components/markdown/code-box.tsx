import { Button, toast } from "@sico/ui";
import { Copy } from "lucide-react";
import {
  type CSSProperties,
  type JSX,
  type ReactNode,
  useCallback,
} from "react";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import csharp from "react-syntax-highlighter/dist/esm/languages/prism/csharp";
import go from "react-syntax-highlighter/dist/esm/languages/prism/go";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import { prism } from "react-syntax-highlighter/dist/esm/styles/prism";

// Register the language set once at module scope; PrismLight + per-language
// imports tree-shake to only these.
SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("ts", typescript);
SyntaxHighlighter.registerLanguage("tsx", typescript);
SyntaxHighlighter.registerLanguage("javascript", javascript);
SyntaxHighlighter.registerLanguage("js", javascript);
SyntaxHighlighter.registerLanguage("jsx", typescript);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("sh", bash);
SyntaxHighlighter.registerLanguage("yaml", yaml);
SyntaxHighlighter.registerLanguage("yml", yaml);
SyntaxHighlighter.registerLanguage("markdown", markdown);
SyntaxHighlighter.registerLanguage("md", markdown);
SyntaxHighlighter.registerLanguage("csharp", csharp);
SyntaxHighlighter.registerLanguage("go", go);
SyntaxHighlighter.registerLanguage("golang", go);
SyntaxHighlighter.registerLanguage("python", python);

// Strip Prism's background/margins/padding/overflow so the SICO card chrome
// owns the surface, and shrink the inner font-size (Prism's default is 1em,
// which overflows the compact card).
const HIGHLIGHTER_STYLE = {
  ...prism,
  'pre[class*="language-"]': {
    ...prism['pre[class*="language-"]'],
    background: "transparent",
    margin: 0,
    padding: 0,
    overflow: "visible",
    fontSize: "0.75rem",
    whiteSpace: "pre-wrap",
    // Prism spreads in wordWrap: "normal"; override the alias too so the wrap
    // doesn't hinge on object-key order winning the inline-style cascade.
    wordWrap: "break-word",
    overflowWrap: "anywhere",
  } as const satisfies CSSProperties,
  'code[class*="language-"]': {
    ...prism['code[class*="language-"]'],
    background: "transparent",
    fontSize: "0.75rem",
    whiteSpace: "pre-wrap",
    wordWrap: "break-word",
    overflowWrap: "anywhere",
  } as const satisfies CSSProperties,
};

export type CodeBoxProps = {
  className?: string;
  children?: ReactNode;
};

// Fenced code block: a default-open <details> card (language label + copy +
// PrismLight body). Tolerates a still-open fence (the streaming tail).
export function CodeBox({ className, children }: CodeBoxProps): JSX.Element {
  const language = className?.replace("language-", "") ?? "text";
  // Body arrives as a string; guard so a node never stringifies to
  // "[object Object]". Trailing newline trimmed.
  const code = typeof children === "string" ? children.replace(/\n$/, "") : "";

  const onCopy = useCallback(async (): Promise<void> => {
    // `clipboard` is undefined in insecure contexts and writeText can reject —
    // surface a non-blocking error.
    try {
      await navigator.clipboard.writeText(code);
      toast.success("Copied to clipboard", { invert: true });
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  }, [code]);

  return (
    <details
      open
      className="border-stroke-subtle-card-rest bg-surface-basic my-2 flex max-h-100 min-w-0 flex-col gap-2 overflow-y-auto rounded-xl border px-4 py-3"
    >
      <summary className="text-foreground-tertiary flex cursor-pointer items-center justify-between text-xs font-medium tracking-wider uppercase">
        <span>{language}</span>
        <Button
          type="button"
          variant="subtle"
          size="icon-sm"
          aria-label="Copy code"
          onClick={onCopy}
        >
          <Copy />
        </Button>
      </summary>
      <SyntaxHighlighter
        style={HIGHLIGHTER_STYLE}
        language={language}
        PreTag="div"
      >
        {code}
      </SyntaxHighlighter>
    </details>
  );
}
