import { type JSX, memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { CodeBox } from "./code-box";

const remarkPlugins = [remarkGfm];

// Token-mapped renderers: every element uses a SICO semantic token, never raw hex.
const components: Components = {
  h1: ({ children }) => (
    <h1 className="text-foreground-emphasis pt-4 pb-4 text-2xl font-medium first:pt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-foreground-emphasis pt-4 pb-2 text-xl font-medium first:pt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-foreground-emphasis pt-4 pb-2 text-lg font-medium first:pt-0">
      {children}
    </h3>
  ),
  // Figma stops at H3; H4 spacing (12/8) follows legacy.
  h4: ({ children }) => (
    <h4 className="text-foreground-emphasis pt-3 pb-2 text-base font-medium first:pt-0">
      {children}
    </h4>
  ),
  p: ({ children }) => (
    <p className="text-foreground-primary leading-body py-2 first:pt-0 last:pb-0">
      {children}
    </p>
  ),
  // Bold maps to medium (500), not the UA default 700 — the type system is
  // capped at two weights (400/500). Color inherits from the parent.
  strong: ({ children }) => <strong className="font-medium">{children}</strong>,
  b: ({ children }) => <b className="font-medium">{children}</b>,
  // New tab, hardened rel against tab-nabbing + Referer leak. `break-words` so a
  // long unbroken link URL wraps instead of overflowing its container (chat
  // inherits the agent body's `wrap-anywhere`; this covers the other contexts).
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-foreground-link-rest hover:text-foreground-link-hover active:text-foreground-link-pressed break-words"
    >
      {children}
    </a>
  ),
  // <img> needs its own referrerPolicy — rel="noreferrer" doesn't cover it.
  img: ({ src, alt }) => (
    <img
      src={src}
      alt={alt ?? ""}
      loading="lazy"
      referrerPolicy="no-referrer"
      className="shadow-m rounded-sm"
    />
  ),
  ul: ({ children }) => (
    <ul className="text-foreground-primary leading-body list-disc py-2 pl-6 first:pt-0 last:pb-0">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="text-foreground-primary leading-body list-decimal py-2 pl-6 first:pt-0 last:pb-0">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pb-1 last:pb-0">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="text-foreground-secondary border-divider border-l-2 py-2 pl-4 first:pt-0 last:pb-0">
      {children}
    </blockquote>
  ),
  // Boxed: rounded outer card, filled header band, divider row separators
  // only. border-separate + spacing-0 lets overflow-hidden clip the corners.
  table: ({ children }) => (
    <table className="border-divider leading-body my-2 w-full border-separate border-spacing-0 overflow-hidden rounded-lg border bg-transparent text-sm first:pt-0 last:pb-0">
      {children}
    </table>
  ),
  thead: ({ children }) => (
    <thead className="bg-surface-strong">{children}</thead>
  ),
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr className="[&+tr>td]:border-divider [&+tr>td]:border-t">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="text-foreground-emphasis px-4 py-2.5 text-left align-top font-medium">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="text-foreground-primary px-4 py-2.5 align-top">
      {children}
    </td>
  ),
  hr: () => <hr className="border-divider py-2 first:pt-0 last:pb-0" />,
  // Drop react-markdown's default <pre> wrapper — the `code` override renders a
  // <CodeBox> (<details>), invalid inside <pre>.
  pre: ({ children }) => <>{children}</>,
  // Fenced code (a `language-*` class) → rich CodeBox; inline code → a pill.
  code: ({ className, children }) => {
    if (className?.includes("language-")) {
      return <CodeBox className={className}>{children}</CodeBox>;
    }
    return (
      <code className="bg-surface-muted text-foreground-secondary mx-0.5 rounded px-1.5 py-0.5 align-baseline font-mono text-xs leading-none [:is(td,th)_&]:mx-0">
        {children}
      </code>
    );
  },
};

// Memoized: an unchanged prefix string skips re-render, so settled blocks keep
// DOM identity while the streaming tail re-parses (§6.E7c).
function MarkdownBlockImpl({ content }: { content: string }): JSX.Element {
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
      {content}
    </ReactMarkdown>
  );
}

export const MarkdownBlock = memo(MarkdownBlockImpl);
