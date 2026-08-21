import { type JSX } from "react";

import { FilePreviewer } from "./previewers/file-previewer";
import { MarkdownPreviewer } from "./previewers/markdown-previewer";
import { SandboxPreviewer } from "./previewers/sandbox-previewer";
import { WebpagePreviewer } from "./previewers/webpage-previewer";
import {
  type SidepaneContent,
  type SidepaneKind,
} from "../../atoms/sidepane-atom";

// A previewer for kind K takes exactly that narrowed variant — the same
// `Extract<…,{kind:K}>` prop each previewer already commits to. `Extract` drops
// the `null` arm on its own, so this matches the previewer signatures verbatim
// and the literal below typechecks with NO cast.
type PreviewerFor<K extends SidepaneKind> = (props: {
  content: Extract<SidepaneContent, { kind: K }>;
}) => JSX.Element;

// THE dispatch table (design §6.E2): the shell reads `content.kind` and mounts
// SIDEPANE_REGISTRY[kind] — there is no `switch` anywhere. The mapped type makes
// a missing kind a COMPILE error, so adding D2/D3 = adding one row here while the
// shell, header, atom, and hook never change.
export const SIDEPANE_REGISTRY: { [K in SidepaneKind]: PreviewerFor<K> } = {
  markdown: MarkdownPreviewer,
  webpage: WebpagePreviewer,
  sandbox: SandboxPreviewer,
  file: FilePreviewer,
};

export function renderPreviewer(
  content: NonNullable<SidepaneContent>,
): JSX.Element {
  // The registry guarantees REGISTRY[k] accepts exactly the {kind:k} variant, but
  // TS can't prove that correlation through a union-keyed index (it collapses the
  // call param to `never`). Assert ONCE, here, so consumers stay content-agnostic.
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- the mapped type guarantees this kind→previewer correlation that the union-keyed index erases
  const Previewer = SIDEPANE_REGISTRY[content.kind] as PreviewerFor<
    typeof content.kind
  >;
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- feeds the previewer the matching {kind} variant its narrowed prop demands
  return <Previewer content={content as never} />;
}
