import { Button } from "@sico/ui";
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

  return (
    <div className="flex h-full w-full flex-col gap-6 pt-10 pb-2">
      <header className="flex items-start justify-between gap-4 px-16">
        <div className="flex flex-col gap-1">
          <h1
            tabIndex={-1}
            className="text-foreground-primary text-3xl leading-tight font-medium outline-none"
          >
            Projects
          </h1>
          <p className="text-foreground-secondary text-sm leading-normal">
            Manage hybrid teams and shared assets.
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreateOpen(true)}>
          <Plus aria-hidden="true" />
          Create Project
        </Button>
      </header>
      <div
        ref={scrollRef}
        className="scrollbar min-h-0 flex-1 overflow-y-auto px-16 pb-8"
      >
        <ErrorBoundary FallbackComponent={ErrorView} onReset={reset}>
          <Suspense fallback={<ProjectsGridSkeleton />}>
            <ProjectsGrid
              rootRef={scrollRef}
              onCreate={() => setCreateOpen(true)}
            />
          </Suspense>
        </ErrorBoundary>
      </div>
      {createOpen && (
        <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
      )}
    </div>
  );
}
