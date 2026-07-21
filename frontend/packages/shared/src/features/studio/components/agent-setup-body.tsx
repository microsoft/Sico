import { Button, toast } from "@sico/ui";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { type JSX, useCallback, useRef, useState } from "react";

import { DeployDialog } from "./deploy-dialog";
import {
  SETUP_SKILLS_PAGE_SIZE,
  SetupBasicInfo,
  SetupSkillSection,
  useRolesQuery,
  useSkillsSuspenseInfiniteQuery,
} from "../../skill";
import {
  useDeploySingleAgentMutation,
  useUpdateSingleAgentMutation,
} from "../hooks/use-single-agent-mutations";
import { useSingleAgentSuspenseQuery } from "../hooks/use-single-agent-query";

// Edit-mode body: Save persists Basic Info edits; Deploy confirms then lands on
// the new instance's Collaboration page. Suspends on the agent + first skills
// page (seeded by the route loader) so it renders without its own spinner.
export function AgentSetupBody({ agentId }: { agentId: string }): JSX.Element {
  const agent = useSingleAgentSuspenseQuery(agentId);
  const roles = useRolesQuery();
  // Gate on the first skills page too — same key/params as SetupSkillSection's
  // infinite query, so the section reads it from cache without a loading state.
  useSkillsSuspenseInfiniteQuery({ agentId, pageSize: SETUP_SKILLS_PAGE_SIZE });
  const navigate = useNavigate();
  const { mutateAsync: updateAgent } = useUpdateSingleAgentMutation();
  const { mutateAsync: deployAgent, isPending: deploying } =
    useDeploySingleAgentMutation();
  const [deployOpen, setDeployOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const name = agent.data.name ?? "";
  const role = agent.data.role ?? "";
  const canDeploy = Boolean(name.trim() && role.trim());

  // On failure the toast surfaces it and we rethrow the original error so the
  // draft stays dirty for a retry (SetupBasicInfo swallows it to keep the draft).
  const handleSave = useCallback(
    async (next: { name: string; role: string }) => {
      try {
        await updateAgent({ agentId, name: next.name, role: next.role });
        toast.success("Updated successfully!", { invert: true });
      } catch (error) {
        toast.error("Failed to update digital worker.");
        throw error;
      }
    },
    [updateAgent, agentId],
  );

  const onDeployConfirm = useCallback(async () => {
    try {
      const { id } = await deployAgent({ agentId, name: name.trim() });
      setDeployOpen(false);
      toast.success("Deployed successfully!", { invert: true });
      await navigate({
        to: "/digital-worker/$agentId/collaboration",
        params: { agentId: String(id) },
      });
    } catch {
      toast.error("Failed to deploy digital worker.");
    }
  }, [deployAgent, agentId, name, navigate]);

  return (
    <>
      <header className="flex h-12 shrink-0 items-center justify-between pr-3 pl-4">
        <div className="flex items-center gap-1">
          <Link
            to="/studio"
            aria-label="Back to Studio"
            className="text-foreground-secondary hover:text-foreground-primary inline-flex size-7 items-center justify-center rounded-md no-underline"
          >
            <ChevronLeft className="size-5" aria-hidden />
          </Link>
          <h1 className="text-foreground-primary text-base font-medium">
            Digital worker Setup
          </h1>
        </div>
        <Button
          variant="secondary"
          disabled={!canDeploy || deploying}
          onClick={() => setDeployOpen(true)}
        >
          {deploying ? "Deploying…" : "Deploy"}
        </Button>
      </header>
      <div
        ref={scrollRef}
        className="scrollbar min-h-0 flex-1 overflow-y-auto pb-6"
      >
        <div className="mx-auto flex min-h-full w-full max-w-230 flex-col gap-6 px-6 pt-2">
          <SetupBasicInfo
            name={name}
            role={role}
            roleOptions={roles.data ?? []}
            onSave={handleSave}
          />
          <SetupSkillSection agentId={agentId} rootRef={scrollRef} />
        </div>
      </div>
      <DeployDialog
        open={deployOpen}
        onOpenChange={setDeployOpen}
        onConfirm={onDeployConfirm}
        pending={deploying}
      />
    </>
  );
}
