import { atom } from "jotai";

// The asset-detail "Detail" side-panel's collapse state. A SINGLE global flag
// (not keyed by projectId like `projectDrawerCollapsedAtom`) because only one
// asset-detail page is ever open at a time. Session-local UI preference — a
// collapse choice carries to the next asset, which is the intended sticky UX.
export const assetDetailPanelCollapsedAtom = atom(false);
