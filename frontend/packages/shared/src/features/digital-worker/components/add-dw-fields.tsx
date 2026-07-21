import {
  Field,
  FieldError,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@sico/ui";
import { ArrowUpRight } from "lucide-react";
import type * as React from "react";
import { type Control, Controller } from "react-hook-form";
import { z } from "zod";

import { DwAvatarPicker } from "./dw-avatar-picker";
import { StatusRow } from "./status-row";
import { ProjectAvatar } from "../../../components/project-avatar";
import { type Project } from "../../projects/schemas/project";
import { type SingleAgentCard } from "../../studio/schemas/single-agent-card";
import { DW_AVATAR_PRESETS } from "../constants";
import { type LoadState, placeholderFor } from "../utils/load-state";

export const addDwSchema = z.object({
  projectId: z.string().min(1, "Pick a project"),
  agentId: z.string().min(1, "Pick a digital worker"),
  name: z.string().min(1, "Name is required").max(20, "Name is too long"),
  iconUri: z.string(),
});
export type AddDwValues = z.infer<typeof addDwSchema>;

export const ADD_DW_INITIAL_VALUES: AddDwValues = {
  projectId: "",
  agentId: "",
  name: "",
  iconUri: DW_AVATAR_PRESETS[0],
};

const UPPER_LABEL =
  "text-foreground-secondary text-xs font-semibold tracking-wider uppercase";

export function renderProjectField(
  control: Control<AddDwValues>,
  projects: Project[],
  state: LoadState,
  onCreate: () => void,
): React.JSX.Element {
  const placeholder = placeholderFor(state, "Select a project…", "projects");
  return (
    <Controller
      name="projectId"
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid ? true : undefined}>
          <FieldLabel htmlFor="add-dw-project" className={UPPER_LABEL}>
            Project
          </FieldLabel>
          <Select
            value={field.value || null}
            onValueChange={(next) => field.onChange(next ?? "")}
            disabled={state === "loading" || state === "error"}
          >
            <SelectTrigger id="add-dw-project" className="w-full pl-3">
              <SelectValue placeholder={placeholder}>
                {(value: string | null) => {
                  const project = projects.find((p) => String(p.id) === value);
                  return project ? (
                    <>
                      <ProjectAvatar project={project} size="xs" decorative />
                      {project.name}
                    </>
                  ) : (
                    placeholder
                  );
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent
              alignItemWithTrigger={false}
              // pb-0 removes the base p-1 bottom padding so the sticky "Create
              // Project" footer sits flush at the bottom — otherwise the 4px
              // padding shows the popover background below it ("漏底").
              className="scrollbar max-h-[min(var(--available-height),--spacing(85))] pb-0"
            >
              {state === "empty" ? (
                <StatusRow>No projects yet — create your first one.</StatusRow>
              ) : (
                projects.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    <ProjectAvatar project={p} size="xs" decorative />
                    {p.name}
                  </SelectItem>
                ))
              )}
              <button
                type="button"
                onClick={onCreate}
                className="text-foreground-secondary hover:bg-surface-raised focus-visible:bg-surface-raised border-stroke-subtle-card-rest bg-popover sticky bottom-0 z-10 flex h-10 w-full items-center rounded-b-lg border-t px-3 text-sm outline-hidden"
              >
                Create Project
                <ArrowUpRight className="ml-1 size-4 shrink-0" />
              </button>
            </SelectContent>
          </Select>
          {state === "error" && (
            <FieldError>
              Couldn&apos;t load projects. Try reopening the dialog.
            </FieldError>
          )}
          {fieldState.error?.message && (
            <FieldError>{fieldState.error.message}</FieldError>
          )}
        </Field>
      )}
    />
  );
}

export function renderDwField(
  control: Control<AddDwValues>,
  templates: SingleAgentCard[],
  state: LoadState,
  onPick: (card: SingleAgentCard | undefined) => void,
): React.JSX.Element {
  const placeholder = placeholderFor(
    state,
    "Select a digital worker…",
    "digital workers",
  );
  return (
    <Controller
      name="agentId"
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid ? true : undefined}>
          <FieldLabel htmlFor="add-dw-template" className={UPPER_LABEL}>
            Digital worker
          </FieldLabel>
          <Select
            value={field.value || null}
            onValueChange={(next) => {
              field.onChange(next ?? "");
              onPick(templates.find((t) => t.agentId === next));
            }}
            disabled={state === "loading" || state === "error"}
          >
            <SelectTrigger id="add-dw-template" className="w-full">
              <SelectValue placeholder={placeholder}>
                {(value: string | null) => {
                  const card = templates.find((t) => t.agentId === value);
                  return card ? card.name : placeholder;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent
              alignItemWithTrigger={false}
              className="scrollbar max-h-[min(var(--available-height),--spacing(85))]"
            >
              {state === "empty" ? (
                <StatusRow>No digital workers available yet.</StatusRow>
              ) : (
                templates.map((card) => (
                  <SelectItem
                    key={card.agentId}
                    value={card.agentId}
                    label={card.name}
                    className="h-auto items-start py-2"
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-foreground-primary text-sm font-medium">
                        {card.name}
                      </span>
                      {card.role ? (
                        <span className="text-foreground-tertiary text-xs leading-snug whitespace-normal">
                          {card.role}
                        </span>
                      ) : null}
                    </span>
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          {state === "error" && (
            <FieldError>
              Couldn&apos;t load digital workers. Try reopening the dialog.
            </FieldError>
          )}
          {fieldState.error?.message && (
            <FieldError>{fieldState.error.message}</FieldError>
          )}
        </Field>
      )}
    />
  );
}

export function renderNameField(
  control: Control<AddDwValues>,
): React.JSX.Element {
  return (
    <Controller
      name="name"
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid ? true : undefined}>
          <FieldLabel htmlFor="add-dw-name" className={UPPER_LABEL}>
            Name
          </FieldLabel>
          <Input
            id="add-dw-name"
            placeholder="e.g. Nova"
            maxLength={20}
            aria-invalid={fieldState.invalid ? true : undefined}
            name={field.name}
            ref={field.ref}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
          />
          {fieldState.error?.message && (
            <FieldError>{fieldState.error.message}</FieldError>
          )}
        </Field>
      )}
    />
  );
}

export function renderAvatarField(
  control: Control<AddDwValues>,
): React.JSX.Element {
  return (
    <Controller
      name="iconUri"
      control={control}
      render={({ field }) => (
        <Field>
          <FieldLabel className={UPPER_LABEL}>Avatar</FieldLabel>
          <DwAvatarPicker value={field.value} onChange={field.onChange} />
        </Field>
      )}
    />
  );
}
