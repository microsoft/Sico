import { AvatarGroup, AvatarGroupCount } from "@sico/ui";
import { Link } from "@tanstack/react-router";
import type * as React from "react";
import { memo } from "react";

import { Card } from "../../../components/card";
import { DwAvatar } from "../../../components/dw-avatar/dw-avatar";
import { ProjectAvatar } from "../../../components/project-avatar";
import { MAX_VISIBLE_AGENTS } from "../constants";
import type { Project } from "../schemas/project";

export type ProjectCardProps = {
  project: Project;
};

/** Card surface for a single project — whole card links to its overview route. */
function ProjectCardImpl({ project }: ProjectCardProps): React.JSX.Element {
  const visible = project.agentInstances.slice(0, MAX_VISIBLE_AGENTS);
  const overflow = project.agentInstances.length - visible.length;
  const hasAgents = project.agentInstances.length > 0;
  return (
    <Card asChild className="gap-6">
      <Link to="/project/$projectId" params={{ projectId: String(project.id) }}>
        <div className="flex w-full items-center justify-between">
          <ProjectAvatar project={project} size="lg" decorative />
          {hasAgents ? (
            <div className="flex shrink-0 items-center gap-1.5">
              <AvatarGroup data-testid="project-card-avatar-group">
                {visible.map((agent) => (
                  <DwAvatar
                    key={agent.id}
                    agent={{ iconUri: agent.iconUrl }}
                    decorative
                    size="sm"
                  />
                ))}
              </AvatarGroup>
              {overflow > 0 ? (
                <AvatarGroupCount aria-label={`${overflow} more agents`}>
                  +{overflow}
                </AvatarGroupCount>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex w-full flex-col gap-1">
          <p
            title={project.name}
            className="text-foreground-primary leading-body truncate text-lg font-medium"
          >
            {project.name}
          </p>
          <p
            title={project.description}
            className="text-foreground-secondary leading-body truncate text-sm"
          >
            {project.description}
          </p>
        </div>
      </Link>
    </Card>
  );
}

export const ProjectCard = memo(ProjectCardImpl);
