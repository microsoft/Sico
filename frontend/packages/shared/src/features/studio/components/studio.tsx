import { useLingui } from "@lingui/react/macro";
import { Button } from "@sico/ui";
import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { type ReactElement, Suspense, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { CreateStudioAgentDialog } from "./create-studio-agent-dialog";
import { StudioGrid } from "./studio-grid";
import { StudioGridSkeleton } from "./studio-grid-skeleton";
import { StudioTabs } from "./studio-tabs";
import { ErrorView } from "../../../components/error-view";
import { useBoundOrganizationQuery } from "../../../hooks/use-bound-organization";
import { type StudioTab } from "../utils/studio-agent-selectors";

export type StudioProps = {
  activeTab?: StudioTab;
};

export function Studio({ activeTab = "all" }: StudioProps): ReactElement {
  const { t } = useLingui();
  const [createOpen, setCreateOpen] = useState(false);
  const { reset } = useQueryErrorResetBoundary();
  const { data: organization } = useBoundOrganizationQuery();
  return (
    <div className="bg-surface-canvas flex h-full w-full flex-col gap-6 pt-6 pb-2">
      <header className="px-5 lg:px-16">
        <div className="flex flex-col gap-1">
          <h1 className="text-foreground-primary text-3xl leading-tight font-medium outline-none">
            {t({ id: "studio.page.title", message: "Studio" })}
          </h1>
          <p className="text-foreground-tertiary text-sm leading-normal">
            {t({
              id: "studio.page.subtitle",
              message: "Configure and deploy digital worker",
            })}
          </p>
        </div>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 lg:px-16">
        <StudioTabs activeTab={activeTab} />
        <Button variant="subtle" onClick={() => setCreateOpen(true)}>
          <Plus aria-hidden />
          {t({ id: "studio.page.create", message: "Create" })}
        </Button>
      </div>
      <div className="scrollbar min-h-0 flex-1 overflow-y-auto px-5 pb-8 lg:px-16">
        <ErrorBoundary
          FallbackComponent={ErrorView}
          onReset={reset}
          resetKeys={[activeTab, organization?.id]}
        >
          <Suspense fallback={<StudioGridSkeleton />}>
            <StudioGrid activeTab={activeTab} />
          </Suspense>
        </ErrorBoundary>
      </div>
      {createOpen ? (
        <CreateStudioAgentDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
        />
      ) : null}
    </div>
  );
}
