/**
 * Copyright (c) 2026 Sico Authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldGroup,
} from "@sico/ui";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue, useSetAtom } from "jotai";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import type * as React from "react";
import { useForm } from "react-hook-form";

import {
  ADD_DW_INITIAL_VALUES,
  addDwSchema,
  type AddDwValues,
  renderAvatarField,
  renderDwField,
  renderNameField,
  renderProjectField,
} from "./add-dw-fields";
import { userAtom } from "../../../atoms/auth-atom";
import { createProjectDialogOpenAtom } from "../../projects/atoms/create-project-dialog-atom";
import { useProjectsInfiniteQueryNonSuspense } from "../../projects/hooks/use-projects-query";
import { useAgentInfosQuery } from "../../studio/hooks/use-agent-infos-query";
import { type SingleAgentCard } from "../../studio/schemas/single-agent-card";
import { useAddDwSubmit } from "../hooks/use-add-dw-submit";
import { deriveState } from "../utils/load-state";

export type AddDwDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Controlled dialog to add a digital worker into a project: pick a project →
 * pick a DW (agent template; role carried from the template) → name it → pick an
 * avatar. Submit creates the instance directly under the project (projectId is a
 * required field on the create endpoint). RHF + zodResolver + `@sico/ui` `Field`.
 * Field markup lives in `add-dw-fields.tsx`. */
export function AddDwDialog({
  open,
  onOpenChange,
}: AddDwDialogProps): React.JSX.Element {
  const user = useAtomValue(userAtom);
  const navigate = useNavigate();
  const setCreateProjectOpen = useSetAtom(createProjectDialogOpenAtom);
  // Non-suspense read: the dialog mounts outside the route's Suspense boundary,
  // so a suspending query would blank the whole page. The list-page loader has
  // usually warmed this cache already.
  const projectsQuery = useProjectsInfiniteQueryNonSuspense({});
  const projects =
    projectsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const projectsState = deriveState(
    projectsQuery.isPending,
    projectsQuery.isError,
    projects.length,
  );
  const templatesQuery = useAgentInfosQuery();
  const templates = templatesQuery.data ?? [];
  const templatesState = deriveState(
    templatesQuery.isPending,
    templatesQuery.isError,
    templates.length,
  );
  const form = useForm<AddDwValues>({
    resolver: zodResolver(addDwSchema),
    defaultValues: ADD_DW_INITIAL_VALUES,
    mode: "onSubmit",
    reValidateMode: "onChange",
  });
  const { onSubmit, isPending } = useAddDwSubmit(user?.email, templates, () =>
    onOpenChange(false),
  );

  useEffect(() => {
    if (open) {
      form.reset(ADD_DW_INITIAL_VALUES);
    }
  }, [open, form]);

  // "Create project" leaves the Add DW flow and navigates to the Projects page
  // with the create dialog raised via a jotai atom (§ create-project lives on
  // /project, not nested here; intent flows through state, not the URL).
  const handleCreateProject = (): void => {
    onOpenChange(false);
    setCreateProjectOpen(true);
    void navigate({ to: "/project" });
  };

  // Seed the name from the picked template while the name is untouched.
  const handlePick = (card: SingleAgentCard | undefined): void => {
    if (card && !form.getFieldState("name").isDirty) {
      form.setValue("name", card.name);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="content" className="w-150">
        <DialogHeader>
          <DialogTitle>Add Digital Worker</DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            {renderProjectField(
              form.control,
              projects,
              projectsState,
              handleCreateProject,
            )}
            {renderDwField(form.control, templates, templatesState, handlePick)}
            {renderNameField(form.control)}
            {renderAvatarField(form.control)}
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="subtle"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              aria-busy={isPending}
              disabled={isPending}
            >
              {isPending ? <Loader2 className="animate-spin" /> : null}
              {isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
