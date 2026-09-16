import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { z } from "zod";

// Module-scope `msg()` descriptors (statically extractable); the text resolves
// lazily via zod v4's `error` callback at validation time, so the schema is a
// plain module const — no factory, no injected `t`, and always in the active
// locale.
const PROJECT_REQUIRED = msg({
  id: "digitalWorker.addDialog.validation.projectRequired",
  message: "Pick a project",
});
const WORKER_REQUIRED = msg({
  id: "digitalWorker.addDialog.validation.workerRequired",
  message: "Pick a digital worker",
});
const NAME_REQUIRED = msg({
  id: "digitalWorker.addDialog.validation.nameRequired",
  message: "Name is required",
});
const NAME_TOO_LONG = msg({
  id: "digitalWorker.addDialog.validation.nameTooLong",
  message: "Name is too long",
});

export const addDwSchema = z.object({
  projectId: z.string().min(1, { error: () => i18n._(PROJECT_REQUIRED) }),
  agentId: z.string().min(1, { error: () => i18n._(WORKER_REQUIRED) }),
  name: z
    .string()
    .min(1, { error: () => i18n._(NAME_REQUIRED) })
    .max(20, { error: () => i18n._(NAME_TOO_LONG) }),
  iconUri: z.string(),
});

export type AddDwValues = {
  projectId: string;
  agentId: string;
  name: string;
  iconUri: string;
};

export const ADD_DW_INITIAL_VALUES: AddDwValues = {
  projectId: "",
  agentId: "",
  name: "",
  iconUri: "",
};
