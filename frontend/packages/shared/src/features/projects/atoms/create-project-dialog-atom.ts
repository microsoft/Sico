// Cross-route flag for the create-project dialog. The Add DW dialog's "Create
// project" link navigates to `/project` and flips this atom so the dialog opens
// on arrival — without threading intent through a URL search param. Session-only
// (no LS): a refresh should NOT re-open the dialog.
import { atom, type PrimitiveAtom } from "jotai";

export const createProjectDialogOpenAtom: PrimitiveAtom<boolean> = atom(false);
