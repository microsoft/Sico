import { Trans } from "@lingui/react/macro";
import { Button } from "@sico/ui";
import { cn } from "@sico/ui/lib/utils.ts";
import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { Plus } from "lucide-react";
import type * as React from "react";
import { type RefObject, Suspense, useRef } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { CreateProjectDialog } from "./create-project-dialog";
import { ProjectsGrid } from "./projects-grid";
import { ProjectsGridSkeleton } from "./projects-grid-skeleton";
import { ErrorView } from "../../../components/error-view";
import { useBoundOrganizationQuery } from "../../../hooks/use-bound-organization";
import { createProjectDialogOpenAtom } from "../atoms/create-project-dialog-atom";

/**
 * Feature root for `/project`. `useQueryErrorResetBoundary` is critical:
 * without piping its `reset` into `ErrorBoundary.onReset`, "Try again"
 * remounts the subtree but the failed query stays in error state, so the
 * suspense hook re-throws on remount and the user is stuck.
 *
 * Layout: the header stays fixed while the grid scrolls inside a bounded
 * `scrollRef` container (local scroll), mirroring `<DigitalWorkers>`.
 *
 * The create-project dialog's open state lives in `createProjectDialogOpenAtom`
 * so the Add DW dialog can raise it via a plain `/project` navigation (no URL
 * search param).
 */
export function Projects(): React.JSX.Element {
  const { reset } = useQueryErrorResetBoundary();
  const scrollRef: RefObject<HTMLDivElement | null> = useRef(null);
  const [createOpen, setCreateOpen] = useAtom(createProjectDialogOpenAtom);
  const { data: organization } = useBoundOrganizationQuery();
  const canCreate = Boolean(organization);

  return (
    <div className="flex h-full w-full flex-col gap-6 pt-10 pb-2">
      <header className="flex items-start justify-between gap-4 px-16">
        <div
          className={cn(
            "flex flex-col gap-1 transition-[filter] duration-100",
            createOpen && canCreate && "blur-xs",
          )}
        >
          <h1
            tabIndex={-1}
            className="text-foreground-primary text-3xl leading-tight font-medium outline-none"
          >
            <Trans id="projects.page.title">Projects</Trans>
          </h1>
          <p className="text-foreground-secondary text-sm leading-normal">
            <Trans id="projects.page.subtitle">
              Track project performance and knowledge.
            </Trans>
          </p>
        </div>
        {canCreate ? (
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden="true" />
            <Trans id="projects.page.createButton">Create Project</Trans>
          </Button>
        ) : null}
      </header>
      <div
        ref={scrollRef}
        className="scrollbar min-h-0 flex-1 overflow-y-auto px-16 pb-8"
      >
        <ErrorBoundary FallbackComponent={ErrorView} onReset={reset}>
          <Suspense fallback={<ProjectsGridSkeleton />}>
            <ProjectsGrid
              rootRef={scrollRef}
              onCreate={canCreate ? () => setCreateOpen(true) : undefined}
            />
          </Suspense>
        </ErrorBoundary>
      </div>
      {createOpen && organization ? (
        <CreateProjectDialog
          organizationId={organization.id}
          open={createOpen}
          onOpenChange={setCreateOpen}
        />
      ) : null}
    </div>
  );
}
