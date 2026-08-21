import { toast } from "@sico/ui";
import { useNavigate } from "@tanstack/react-router";
import { type JSX, useCallback } from "react";

import { SetupBasicInfo, SetupSkillSection, useRolesQuery } from "../../skill";
import { useCreateSingleAgentMutation } from "../hooks/use-single-agent-mutations";

// Create-mode body: Save creates the agent then replace-navigates to the edit
// route — the back button still returns to Studio, not this transient page. On
// failure the toast surfaces it and we rethrow the original error so the form
// stays dirty for a retry (SetupBasicInfo swallows it to keep the draft).
export function CreateSetupBody(): JSX.Element {
  const roles = useRolesQuery();
  const navigate = useNavigate();
  const { mutateAsync: createAgent } = useCreateSingleAgentMutation();
  // Empty initial values kept off the JSX as literals — a literal `role=""`
  // trips `jsx-a11y/aria-role`, which mistakes this domain prop for an ARIA
  // attribute (the edit route sidesteps it the same way via a non-literal).
  const initial = { name: "", role: "" };

  const handleSave = useCallback(
    async ({ name, role }: { name: string; role: string }) => {
      try {
        const { agentId } = await createAgent({ name, role });
        toast.success("Created successfully!", { invert: true });
        await navigate({
          to: "/studio/$agentId/setup",
          params: { agentId },
          replace: true,
        });
      } catch (error) {
        toast.error("Failed to create digital worker.");
        throw error;
      }
    },
    [createAgent, navigate],
  );

  return (
    <>
      <SetupBasicInfo
        name={initial.name}
        role={initial.role}
        roleOptions={roles.data ?? []}
        onSave={handleSave}
      />
      <SetupSkillSection />
    </>
  );
}
